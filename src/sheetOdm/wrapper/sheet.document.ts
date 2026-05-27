import { SheetsRepository } from '@sheetOdm/repository/sheets.repository';
import { SHEETS_COLUMN_DETAILS } from '@sheetOdm/constants/metadata.constants';

export function deepClone<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item)) as unknown as T;
    }
    if (typeof obj === 'object') {
        const cloned: any = {};
        for (const key of Object.keys(obj)) {
            cloned[key] = deepClone((obj as any)[key]);
        }
        return cloned;
    }
    return obj;
}

export class SheetDocument<T extends object> {
    public __row?: number;
    protected _isNew: boolean;
    protected _snapshot: any;
    protected _entityClass: any;
    protected readonly _repo: SheetsRepository<T>;

    constructor(data: Partial<T>, repo: SheetsRepository<T>, isNew = true) {
        this._repo = repo;
        this._isNew = isNew;
        this.__row = (data as any).__row;

        // Hidratar campos
        Object.assign(this, data);

        // Guardar snapshot para delta tracking
        this._snapshot = this.toObject(true);
    }

    /**
     * Compara el estado actual con el snapshot inicial para determinar si un campo o todo el documento ha mutado.
     */
    isModified(path?: string): boolean {
        if (this._isNew) return true;

        if (path) {
            return JSON.stringify(this._snapshot[path]) !== JSON.stringify((this as any)[path]);
        }

        // Obtener todas las propiedades decoradas como columnas
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

    /**
     * Convierte la instancia activa en un objeto plano (POJO).
     * @param includeRow Si es true, incluye el identificador de fila física __row.
     */
    toObject(includeRow = false): T {
        const obj: any = {};

        // Solo copiamos las propiedades que están registradas como Columnas en los metadatos
        const targetPrototype = this._entityClass ? this._entityClass.prototype : Object.getPrototypeOf(this);
        const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, targetPrototype) || {};
        const columns = Object.keys(details);

        for (const col of columns) {
            obj[col] = (this as any)[col] !== undefined ? (this as any)[col] : null;
        }

        if (includeRow && this.__row !== undefined) {
            obj.__row = this.__row;
        }

        return obj as T;
    }

    /**
     * Guarda los cambios locales del documento en la hoja de Google Sheets.
     */
    async save(): Promise<T> {
        let result: T;

        if (this._isNew) {
            const dataToCreate = this.toObject();
            result = await this._repo.create(dataToCreate);
            this._isNew = false;
        } else {
            const dataToUpdate = this.toObject();
            const pkField = this._repo.getPrimaryKeyField();
            const id = (this as any)[pkField];

            // Si tenemos el número de fila física, lo mandamos para optimizar la velocidad
            result = await this._repo.update(id, dataToUpdate, { rowNumber: this.__row });
        }

        // Sincronizar el estado del documento con el resultado retornado
        Object.assign(this, result);
        this.__row = (result as any).__row;
        this._snapshot = this.toObject(true);

        return this as unknown as T;
    }

    /**
     * Elimina lógicamente (o físicamente si no tiene DeleteControl) el registro de la hoja.
     */
    async softDelete(): Promise<void> {
        if (this._isNew) return;

        const pkField = this._repo.getPrimaryKeyField();
        const id = (this as any)[pkField];

        const deleted = await this._repo.delete(id);
        if (deleted) {
            this._isNew = true;
            this.__row = undefined;
            this._snapshot = {};
        }
    }
}
