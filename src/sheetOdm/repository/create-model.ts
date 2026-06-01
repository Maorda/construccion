import { Inject, Logger } from '@nestjs/common';
import {
    SHEETS_COLUMN_DETAILS,
    SHEETS_COLUMN_LIST,
    SHEETS_TABLE_NAME,
    SHEETS_PRIMARY_KEY,
    SHEETS_DELETE_CONTROL,
    SHEETS_VERSION_FIELD,
    ROW_INDEX_SYMBOL
} from '@sheetOdm/constants/metadata.constants';
import { SheetsRepository } from './sheets.repository';
import { ClassType, FilterQuery, QueryOptions } from '@sheetOdm/types/query.types';
import { SheetDocument } from '@sheetOdm/wrapper/sheetDocument';
import { deepClone } from '@sheetOdm/utils/helper';
import { RelationEngine } from '@sheetOdm/engines/relationEngine';

export const InjectModel = (entity: Function) => Inject(`${entity.name}Model`);

export type Model<T extends object> = {
    new(data?: Partial<T>): T & SheetDocument<T>;
    save(data: Partial<T>): Promise<T & SheetDocument<T>>;
    find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<(T & SheetDocument<T>)[]>;
    findOne(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<(T & SheetDocument<T>) | null>;
    findOneAndUpdate(filter: FilterQuery<T>, update: any, options?: any): Promise<(T & SheetDocument<T>) | null>;
    aggregate<R = any>(pipeline: any[]): Promise<R[]>;
};

// Se añade RelationEngine como dependencia opcional para soportar el .populate()
export function createModel<T extends object>(
    entityClass: ClassType<T>,
    repo: SheetsRepository<T>,
    relationEngine?: RelationEngine
): Model<T> {

    // 1. Creación de la Clase Dinámica que une Documento + Repositorio
    const ModelClass = class extends SheetDocument<T> {
        constructor(data?: Partial<T>) {
            const dataObj = (data || {}) as Partial<T>;
            const rowNumber = (dataObj as any)[ROW_INDEX_SYMBOL];
            const version = (dataObj as any).version || 0;
            const isNew = rowNumber === undefined;

            // Invocamos a SheetDocument SIN el repo
            super(dataObj, isNew, entityClass, rowNumber, version);

            try {
                (this as any)._snapshot = isNew ? {} : deepClone(dataObj);
            } catch (e) {
                (this as any)._snapshot = dataObj;
            }
        }

        // --- IMPLEMENTACIÓN DE LOS CONTRATOS DE ACTIVE RECORD ---

        async save(): Promise<this> {
            if (!this.isDirty && !this.isNew) return this;

            // Usamos el 'repo' atrapado en el closure del factory
            const savedDoc = await repo.save(this as any);

            // Sincronizamos el estado interno con lo devuelto por la DB
            Object.assign(this._data, savedDoc.toObject());
            if (savedDoc[ROW_INDEX_SYMBOL] !== undefined) {
                this.markAsSaved(savedDoc[ROW_INDEX_SYMBOL]!);
            }
            this.setVersion(savedDoc.version);

            return this;
        }

        async remove(): Promise<boolean> {
            return await repo.delete(this as any);
        }

        async populate(path: string): Promise<this> {
            if (!relationEngine) {
                throw new Error(`[SheetODM] RelationEngine no fue provisto al crear el modelo de ${entityClass.name}.`);
            }
            // Asumiendo que repo provee una forma de obtener otros repos, o inyectas el provider en createModel
            const repoProvider = (targetClass: ClassType<any>) => null; // Ajusta esto según cómo resuelvas repositorios globalmente

            await relationEngine.populateDeep(this, path, repoProvider);
            return this;
        }
    };

    // 2. Vinculación Dinámica de Metadatos
    const metadataKeys = [
        SHEETS_COLUMN_DETAILS, SHEETS_COLUMN_LIST, SHEETS_TABLE_NAME,
        SHEETS_PRIMARY_KEY, SHEETS_DELETE_CONTROL, SHEETS_VERSION_FIELD
    ];

    metadataKeys.forEach(key => {
        const value = Reflect.getMetadata(key, entityClass.prototype);
        if (value) Reflect.defineMetadata(key, value, ModelClass.prototype);
    });

    // 3. Métodos Estáticos del Modelo
    const staticModel = ModelClass as any;

    staticModel.find = (filter?: FilterQuery<T>, options?: QueryOptions<T>) =>
        repo.find(filter, { ...options, customConstructor: ModelClass } as any);

    staticModel.findOne = (filter?: FilterQuery<T>, options?: QueryOptions<T>) =>
        repo.findOne(filter, { ...options, customConstructor: ModelClass } as any);

    staticModel.findOneAndUpdate = (filter: FilterQuery<T>, update: any, options?: any) =>
        (repo as any).findOneAndUpdate(filter, update, { ...options, customConstructor: ModelClass });

    staticModel.aggregate = (pipeline: any[]) => repo.aggregate(pipeline);

    staticModel.save = async (data: Partial<T>) => {
        const instance = new ModelClass(data);
        return await instance.save();
    };

    return ModelClass as unknown as Model<T>;
}