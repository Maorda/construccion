import { Inject } from '@nestjs/common';
import { ROW_INDEX_SYMBOL } from '@sheetOdm/constants/metadata.constants.js';
import { SheetsRepository } from './sheets.repository.js';
import { ClassType, FilterQuery, QueryOptions } from '@sheetOdm/types/query.types.js';
import { SheetDocument } from '@sheetOdm/wrapper/sheetDocument.js';
import { RelationEngine } from '@sheetOdm/engines/relationEngine.js';

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
    // 1. Definimos la clase que servirá de contenedor (instancias)
    class ModelClass {
        constructor(data: Partial<T> = {}) {
            const _data = { ...data };
            const _modifiedPaths = new Set<string>();
            let _isNew = (_data as any)[ROW_INDEX_SYMBOL] === undefined;
            let _version = (_data as any).version || 0;

            const instance = Object.assign(Object.create(entityClass.prototype), _data);

            const proxy = new Proxy(instance, {
                get(target, prop, receiver) {
                    if (prop === '_data') return _data;
                    if (prop === '_isNew') return _isNew;
                    return Reflect.get(target, prop, receiver);
                },
                set(target, prop, value, receiver) {
                    if (target[prop] !== value) {
                        _modifiedPaths.add(prop as string);
                        _data[prop as keyof T] = value;
                    }
                    return Reflect.set(target, prop, value, receiver);
                }
            });

            // Definimos el método save en la instancia (capacidad Active Record)
            Object.defineProperty(proxy, 'save', {
                value: async function () {
                    const saved = await repo.save(proxy as any);
                    Object.assign(_data, saved);
                    return proxy;
                },
                enumerable: false
            });

            return proxy;
        }

        // 2. Implementamos los métodos estáticos del contrato Model<T>
        static async save(data: Partial<T>): Promise<T & SheetDocument<T>> {
            const instance = new ModelClass(data);
            return (instance as any).save();
        }

        static async find(filter?: any, options?: any) {
            return await repo.find(filter, options);
        }

        static async findOne(filter?: any, options?: any) {
            return await repo.findOne(filter, options);
        }

        static async findOneAndUpdate(filter: any, update: any, options?: any) {
            return await repo.findOneAndUpdate(filter, update, options);
        }

        static async aggregate<R = any>(pipeline: any[]): Promise<R[]> {
            return await repo.aggregate(pipeline);
        }
    }

    // Retornamos como Model<T> para que TS valide el contrato
    return ModelClass as unknown as Model<T>;
}