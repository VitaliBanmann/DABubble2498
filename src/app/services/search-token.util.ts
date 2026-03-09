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

    parts.forEach((part) => {
        const words = (part ?? '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z0-9]+/)
            .filter((word) => word.length >= 2);

        words.forEach((word) => {
            tokens.add(word);
            tokens.add(word.slice(0, 3));
            tokens.add(word.slice(0, 4));
        });
    });

    return Array.from(tokens).filter((token) => token.length >= 2);
}
