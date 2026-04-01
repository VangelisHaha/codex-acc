export class ProviderRegistry {
    constructor(providers = []) {
        this.providers = providers;
        this.providerMap = new Map(providers.map(provider => [provider.id, provider]));
    }

    list() {
        return [...this.providers];
    }

    get(providerId) {
        return this.providerMap.get(providerId) || null;
    }
}
