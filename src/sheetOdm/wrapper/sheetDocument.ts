import { SHEETS_COLUMN_DETAILS } from "@sheetOdm/constants/metadata.constants";
import { SheetsRepository } from "@sheetOdm/repository/sheets.repository";
import { ClassType } from "@sheetOdm/types/query.types";

export interface IsheetDocument<T = any> {
    toObject(): T;
    save(): Promise<this>;
    delete(): Promise<void>;
    readonly rowNumber: number | null;
    readonly isNew: boolean;
    readonly isDirty: boolean;
}
export class SheetDocument<T extends object> implements IsheetDocument<T> {
    private _data: T;
    private _originalData: T;
    private _rowNumber: number | null; // null significa que aún no existe en el Sheet
    protected _isNew: boolean;
    private _isDeleted: boolean = false;
    private _modifiedPaths: Set<string> = new Set();
    private _relations: Record<string, SheetDocument<T> | SheetDocument<T>[]> = {};
    private _persistenceContext: { flush: () => Promise<void> } | null = null;
    public readonly entityClass: ClassType<T>;
    protected _snapshot: any;
    protected repo: SheetsRepository<T>;

    constructor(data: T, repo: SheetsRepository<T>, isNew = false, entityClass?: ClassType<T>) {
        this._data = { ...data };
        this._originalData = { ...data };
        this._isNew = isNew;
        this.entityClass = entityClass;
        this.repo = repo;



        // Retornamos un Proxy para interceptar cuando el programador cambie una propiedad
        return new Proxy(this, {
            get: (target, prop: string) => {
                if (prop in target) return (target as any)[prop];

                // 1. Verificar si la propiedad es una relación ya poblada (Populated)
                if (target._relations[prop] !== undefined) {
                    return target._relations[prop];
                }

                // 2. Si no está poblada pero es un campo relacional, Mongoose devuelve el ID primitivo
                const metadata = target.getRelationMetadata(entityClass, prop);
                if (metadata) {
                    return (target._data as any)[metadata.foreignKey];
                }

                return (target._data as any)[prop];
            },
            set: (target, prop: string, value: any) => {
                if (prop in target) {
                    (target as any)[prop] = value;
                    return true;
                }

                const metadata = target.getRelationMetadata(entityClass, prop);

                // 3. Interceptar si están asignando un Documento Completo a una relación
                if (metadata && value instanceof SheetDocument) {
                    target._relations[prop] = value; // Guardamos la instancia viva
                    const fk = metadata.foreignKey;
                    const idValue = value.toObject().id; // Extraemos su ID primario

                    if ((target._data as any)[fk] !== idValue) {
                        (target._data as any)[fk] = idValue; // Seteamos la FK en la data cruda
                        target._modifiedPaths.add(fk);      // Marcamos la FK como sucia (dirty)
                    }
                    return true;
                }

                // Asignación de columna común
                if ((target._data as any)[prop] !== value) {
                    (target._data as any)[prop] = value;
                    target._modifiedPaths.add(prop);
                }
                return true;
            }
        });
    }

    // --- GETTERS DE ESTADO ---
    public get rowNumber(): number | null { return this._rowNumber; }
    public get isNew(): boolean { return this._isNew; }
    public get isDeleted(): boolean { return this._isDeleted; }
    public get isDirty(): boolean { return this._modifiedPaths.size > 0; }
    public get modifiedPaths(): string[] { return Array.from(this._modifiedPaths); }

    /**
     * Retorna el objeto plano con la data actual
     */
    public toObject(): T {
        return { ...this._data };
    }

    /**
     * Marca el documento para ser eliminado en el siguiente flush
     */
    public async delete(): Promise<void> {
        this._isDeleted = true;
        // Aquí puedes disparar un evento o registrarlo en la "Unidad de Trabajo" del Engine
    }

    /**
     * Simula el comportamiento de Mongoose para guardar cambios
     */
    public attach(context: { flush: () => Promise<void> }) {
        this._persistenceContext = context;
    }

    public async save(): Promise<this> {

        return this;
    }

    /**
     * Método interno para el Engine cuando los cambios ya impactaron en Google Sheets
     */
    public __commit(newRowNumber?: number) {
        if (newRowNumber !== undefined) this._rowNumber = newRowNumber;
        this._originalData = { ...this._data };
        this._modifiedPaths.clear();
        this._isNew = false;
    }
    private getRelationMetadata(entityClass: any, prop: string): any {
        // Aquí accedes a tu almacenamiento global de reflect-metadata
        return Reflect.getMetadata(`relation:${prop}`, entityClass.prototype);
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
}