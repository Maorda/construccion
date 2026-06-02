export function indexToColumnLetter(index: number): string {
    if (index < 0) return '';
    let temp = index;
    let letter = '';
    while (temp >= 0) {
        letter = String.fromCharCode((temp % 26) + 65) + letter;
        temp = Math.floor(temp / 26) - 1;
    }
    return letter;
}
