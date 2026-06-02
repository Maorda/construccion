export function getNestedValue(obj: any, path: string): any {
    if (!obj) return undefined;
    if (!path.includes('.')) return obj[path];

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}