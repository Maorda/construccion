import { SheetsRepository } from '@sheetOdm/repository/sheets.repository';
import { SHEETS_COLUMN_DETAILS, ROW_INDEX_SYMBOL, SHEETS_VIRTUAL_COLUMNS } from '@sheetOdm/constants/metadata.constants';

export function deepClone<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item)) as unknown as T;
    }
    if (typeof obj === 'object') {
        const cloned: any = {};
        // Object.keys ignora los Symbols, por lo que ROW_INDEX_SYMBOL NO se clonará al snapshot
        for (const key of Object.keys(obj)) {
            cloned[key] = deepClone((obj as any)[key]);
        }
        return cloned;
    }
    return obj;
}

export class SheetDocument1<T extends object> {
    [key: string]: any;

    // Ya no es pública. Se accede mediante el Symbol para evitar colisiones y polución
    protected [ROW_INDEX_SYMBOL]?: number;

    protected _isNew: boolean;
    protected _snapshot: any;
    protected _entityClass: any;
    protected readonly _repo: SheetsRepository<T>;

    constructor(data: Partial<T>, repo: SheetsRepository<T>, isNew = true) {
        this._repo = repo;
        this._isNew = isNew;

        // Asignación del índice de fila usando el Symbol
        this[ROW_INDEX_SYMBOL as any] = (data as any)[ROW_INDEX_SYMBOL];

        // Hidratar campos
        Object.assign(this, data);

        // Guardar snapshot para delta tracking
        this._snapshot = this.toObject(true);
    }

    isModified(path?: string): boolean {
        if (this._isNew) return true;

        if (path) {
            return JSON.stringify(this._snapshot[path]) !== JSON.stringify((this as any)[path]);
        }

        const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, this.constructor.prototype) || {};
        const columns = Object.keys(details);

        for (const col of columns) {
            const snapVal = JSON.stringify(this._snapshot[col]);
            const currentVal = JSON.stringify((this as any)[col]);
            if (snapVal !== currentVal) {
                return true;
            }
        }

        return false;
    }

    toObject(includeRow = false): T {
        const obj: any = {};

        const targetPrototype = this._entityClass ? this._entityClass.prototype : Object.getPrototypeOf(this);
        const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, targetPrototype) || {};
        const columns = Object.keys(details);

        for (const col of columns) {
            obj[col] = (this as any)[col] !== undefined ? (this as any)[col] : null;
        }

        // Si se solicita, extraemos el valor del Symbol y lo ponemos como __row para compatibilidad
        if (includeRow && this[ROW_INDEX_SYMBOL as any] !== undefined) {
            obj.__row = this[ROW_INDEX_SYMBOL as any];
        }

        return obj as T;
    }

    toJSON() {
        const jsonObj: any = {};
        const proto = Object.getPrototypeOf(this);

        // 1. Campos Persistentes (Metadata Registry)
        const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, this.constructor) || {};
        Object.keys(details).forEach(key => {
            jsonObj[key] = (this as any)[key] ?? null;
        });

        // 2. Campos Virtuales (La magia de la proyección automática)
        const virtuals = Reflect.getMetadata(SHEETS_VIRTUAL_COLUMNS, this.constructor) || [];

        virtuals.forEach((v: { propertyKey: string, group: string }) => {
            const value = (this as any)[v.propertyKey];

            // Al ser obligatorio, sabemos que v.group siempre existe
            if (!jsonObj[v.group]) jsonObj[v.group] = {};
            jsonObj[v.group][v.propertyKey] = value;
        });

        return jsonObj;
    }
    async save(): Promise<this> {
        return await this._repo.save(this) as this;
    }

    markAsSaved(rowNumber?: number): void {
        this._isNew = false;
        if (rowNumber) this[ROW_INDEX_SYMBOL as any] = rowNumber;
        this._snapshot = this.toObject(true);
    }
}