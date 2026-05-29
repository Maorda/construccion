export interface ISheetDriver {
    appendRow(sheetName: string, row: any[]): Promise<number>;
    updateRow(sheetName: string, rowNumber: number, values: any[]): Promise<number>;
    getExistingSheetTitles(): Promise<string[]>;
    createSheet(title: string): Promise<any>;
    writeHeaders(sheetName: string, headers: string[]): Promise<any>;
    getRange(range: string): Promise<any[][]>;
}