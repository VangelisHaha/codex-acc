import { createRequire } from 'module';
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

let cachedAgent = null;
let cachedUrl = null;
let cachedProxyAgentClass = null;
let proxyAgentLoadError = null;
let hasWarnedMissingProxyAgent = false;
let cachedLookup = null;
let cachedDnsServer = null;
let cachedVpnAgent = null;
let cachedVpnAgentDnsServer = null;

const require = createRequire(import.meta.url);

// 默认 VPN 内网域名后缀列表，可通过 NIKOU_DNS_DOMAINS 环境变量追加
const DEFAULT_VPN_DOMAINS = [];
let cachedVpnDomains = null;

function loadProxyAgentClass() {
    if (cachedProxyAgentClass || proxyAgentLoadError) {
        return;
    }
    try {
        const mod = require('proxy-agent');
        cachedProxyAgentClass = mod.ProxyAgent || mod.default || mod;
    } catch (error) {
        proxyAgentLoadError = error;
    }
}

function warnMissingProxyAgent() {
    if (hasWarnedMissingProxyAgent) {
        return;
    }
    hasWarnedMissingProxyAgent = true;
    console.warn('[WARNING] proxy-agent 未安装，已自动跳过代理配置。请执行 npm install 以补齐依赖。');
}

/**
 * 从环境变量读取代理地址
 * 优先级：CODEX_ACC_PROXY > HTTPS_PROXY > HTTP_PROXY > ALL_PROXY
 */
export function resolveProxyUrl() {
    return process.env.CODEX_ACC_PROXY
        || process.env.HTTPS_PROXY
        || process.env.HTTP_PROXY
        || process.env.ALL_PROXY
        || '';
}

function normalizeHost(hostname) {
    return (hostname || '').toString().trim().toLowerCase();
}

function normalizeDomainSuffix(value) {
    const raw = (value || '').toString().trim().toLowerCase();
    if (!raw) {
        return '';
    }
    return raw.startsWith('.') ? raw : `.${raw}`;
}

function getVpnDomains() {
    if (cachedVpnDomains) {
        return cachedVpnDomains;
    }
    const extra = (process.env.CODEX_ACC_DNS_DOMAINS || '')
        .split(',')
        .map(item => normalizeDomainSuffix(item))
        .filter(Boolean);
    const normalizedDefaults = DEFAULT_VPN_DOMAINS.map(item => normalizeDomainSuffix(item)).filter(Boolean);
    cachedVpnDomains = Array.from(new Set([...normalizedDefaults, ...extra]));
    return cachedVpnDomains;
}

function isVpnDomain(hostname) {
    const host = normalizeHost(hostname);
    if (!host) {
        return false;
    }
    return getVpnDomains().some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

function resolveVpnDnsServer() {
    const explicit = process.env.CODEX_ACC_DNS || process.env.CODEX_ACC_DNS_SERVER;
    if (explicit) {
        return explicit.trim();
    }
    return '';
}

function isVpnForceEnabled() {
    return process.env.CODEX_ACC_FORCE_VPN === '1' || process.env.CODEX_ACC_FORCE_VPN === 'true';
}

function createVpnResolver(server) {
    const resolver = new dns.Resolver();
    resolver.setServers([server]);
    return resolver;
}

function resolveWithResolver(resolver, hostname, family, options, callback) {
    const wantsAll = !!options?.all;
    const done = (err, addresses) => {
        if (err) {
            callback(err);
            return;
        }
        const list = Array.isArray(addresses) ? addresses : [addresses];
        if (!list.length) {
            callback(new Error(`DNS resolve empty for ${hostname}`));
            return;
        }
        if (wantsAll) {
            const mapped = list
                .filter(Boolean)
                .map((addr) => ({
                    address: addr,
                    family: family || net.isIP(addr) || 4,
                }));
            callback(null, mapped);
            return;
        }
        const address = list[0];
        const resolvedFamily = family || (net.isIP(address) || 4);
        callback(null, address, resolvedFamily);
    };
    if (family === 6) {
        resolver.resolve6(hostname, done);
        return;
    }
    if (family === 4) {
        resolver.resolve4(hostname, done);
        return;
    }
    resolver.resolve4(hostname, (err, addresses) => {
        if (!err && addresses && addresses.length) {
            done(null, addresses);
            return;
        }
        resolver.resolve6(hostname, done);
    });
}

export function getVpnAwareLookup() {
    if (!isVpnForceEnabled()) {
        return null;
    }
    const dnsServer = resolveVpnDnsServer();
    if (!dnsServer) {
        return null;
    }
    if (cachedLookup && cachedDnsServer === dnsServer) {
        return cachedLookup;
    }
    cachedDnsServer = dnsServer;
    const resolver = createVpnResolver(dnsServer);
    cachedLookup = (hostname, options, callback) => {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        const family = typeof options === 'number' ? options : options?.family;
        if (net.isIP(hostname)) {
            const ipFamily = net.isIP(hostname);
            if (options?.all) {
                process.nextTick(callback, null, [{ address: hostname, family: ipFamily }]);
            } else {
                process.nextTick(callback, null, hostname, ipFamily);
            }
            return;
        }
        if (!isVpnDomain(hostname)) {
            dns.lookup(hostname, options || {}, callback);
            return;
        }
        resolveWithResolver(resolver, hostname, family, options, callback);
    };
    return cachedLookup;
}

export function getProxyAgent(proxyUrl = resolveProxyUrl()) {
    if (!proxyUrl) {
        return null;
    }
    loadProxyAgentClass();
    if (!cachedProxyAgentClass) {
        warnMissingProxyAgent();
        return null;
    }
    if (cachedAgent && cachedUrl === proxyUrl) {
        return cachedAgent;
    }
    cachedUrl = proxyUrl;
    cachedAgent = new cachedProxyAgentClass(proxyUrl);
    return cachedAgent;
}

export function getVpnAwareAgent() {
    if (!isVpnForceEnabled()) {
        return null;
    }
    const dnsServer = resolveVpnDnsServer();
    if (!dnsServer) {
        return null;
    }
    if (cachedVpnAgent && cachedVpnAgentDnsServer === dnsServer) {
        return cachedVpnAgent;
    }
    cachedVpnAgentDnsServer = dnsServer;
    const lookup = getVpnAwareLookup();
    if (!lookup) {
        return null;
    }
    const httpAgent = new http.Agent({ lookup });
    const httpsAgent = new https.Agent({ lookup });
    cachedVpnAgent = (parsedUrl) => (parsedUrl?.protocol === 'http:' ? httpAgent : httpsAgent);
    return cachedVpnAgent;
}
