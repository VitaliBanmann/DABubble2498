export function normalizeSearchToken(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}

export function buildSearchTokens(parts: string[]): string[] {
    const tokens = new Set<string>();
    parts.forEach((part) => collectWords(part).forEach((word) => addTokenVariants(tokens, word)));
    return Array.from(tokens).filter((token) => token.length >= 2);
}

function collectWords(part: string): string[] {
    return (part ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 2);
}

function addTokenVariants(tokens: Set<string>, word: string): void {
    tokens.add(word);
    tokens.add(word.slice(0, 3));
    tokens.add(word.slice(0, 4));
}
