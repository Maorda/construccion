import { ROW_INDEX_SYMBOL, SHEETS_VIRTUALS } from "@sheetOdm/constants/metadata.constants";
import { SheetsRepository } from "@sheetOdm/repository/sheets.repository";
import { ClassType } from "@sheetOdm/types/query.types";

export abstract class SheetDocument<T extends object> {
    protected _data: Partial<T>;
    protected _isNew: boolean;
    protected _modifiedPaths: Set<string> = new Set();
    public readonly entityClass: ClassType<T>;
    protected _version: number;

    public [ROW_INDEX_SYMBOL]?: number;

    constructor(
        data: Partial<T> = {},
        protected readonly repo: SheetsRepository<T>,
        isNew = true,
        entityClass?: ClassType<T>,
        rowNumber?: number,
        version = 0
    ) {
        this._data = { ...data };
        this._isNew = isNew;
        this.entityClass = entityClass || (this.constructor as ClassType<T>);
        this[ROW_INDEX_SYMBOL] = rowNumber;
        this._version = version;

        return new Proxy(this, {
            get(target, prop: string | symbol) {
                if (prop in target) return (target as any)[prop];
                if (typeof prop === 'symbol') return undefined;
                return (target._data as any)[prop];
            },
            set(target, prop: string | symbol, value: any) {
                if (prop in target) {
                    (target as any)[prop] = value;
                    return true;
                }
                if ((target._data as any)[prop] !== value) {
                    (target._data as any)[prop] = value;
                    if (typeof prop === 'string') {
                        target._modifiedPaths.add(prop);
                    }
                }
                return true;
            }
        });
    }

    // --- MÉTODOS DE ESTADO ---
    public get version(): number { return this._version; }
    public setVersion(newVersion: number) { this._version = newVersion; }
    public get isNew(): boolean { return this._isNew; }
    public get isDirty(): boolean { return this._modifiedPaths.size > 0; }

    public isModified(path?: string): boolean {
        return path ? this._modifiedPaths.has(path) : this.isDirty;
    }

    public markAsSaved(rowNumber: number): void {
        this._isNew = false;
        this[ROW_INDEX_SYMBOL] = rowNumber;
        this._modifiedPaths.clear();
    }

    // --- CONTRATOS ACTIVE RECORD (Implementados por el Model) ---
    public abstract save(): Promise<this>;
    public abstract remove(): Promise<boolean>;
    public abstract populate(path: string): Promise<this>;

    // --- SERIALIZACIÓN ---
    public toObject(): T {
        return { ...this._data, version: this._version } as T;
    }

    public toJSON() {
        const jsonObj: any = { ...this._data };
        const virtuals = Reflect.getMetadata(SHEETS_VIRTUALS, this.entityClass) || [];
        virtuals.forEach((v: { propertyKey: string, group: string }) => {
            if (!jsonObj[v.group]) jsonObj[v.group] = {};
            jsonObj[v.group][v.propertyKey] = (this as any)[v.propertyKey];
        });
        jsonObj['version'] = this._version;
        return jsonObj;
    }
}