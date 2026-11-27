export class OpenRouterModelPolicyError extends Error {
    constructor() { super('Hosted OpenRouter requires a free model'); }
}

export function requireFreeOpenRouterModel(model: string): string {
    if (model === 'openrouter/free' || /^[a-z0-9_.-]+\/[a-z0-9_.-]+:free$/i.test(model)) return model;
    throw new OpenRouterModelPolicyError();
}
