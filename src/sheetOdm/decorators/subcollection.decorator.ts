import 'reflect-metadata';
import {
    SHEETS_ALL_RELATIONS,
    SHEETS_RELATIONS_LIST
} from '@sheetOdm/constants/metadata.constants';

export const GLOBAL_RELATION_REGISTRY = new Map<string, any[]>();

export interface RelationOptions {
    targetEntity: () => new () => any;
    childRepository?: any | string;
    targetSheet?: string;
    targetRepository?: string;
    joinColumn?: string;       // Inferencia tipo FK (ej. 'obreroId')
    localField?: string;       // Por defecto 'id' o PK
    isMany?: boolean;
    onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
}

type EntityClass = new () => any;

export interface SubCollectionOptions {
    /** Estrategia de integridad referencial al eliminar el registro Padre */
    onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
    /** En caso de requerir mapear un campo destino específico manualmente */
    joinColumn?: string;
    localField?: string;
    cascadeDelete: boolean
}

export function SubCollection(
    arg: EntityClass | (() => EntityClass),
    options?: SubCollectionOptions
): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        const propertyName = propertyKey.toString();

        // 1. Aseguramos que targetEntity SIEMPRE sea una función diferida (() => Clase)
        const targetEntityFn = typeof arg === 'function' && !arg.prototype
            ? (arg as () => EntityClass)
            : () => arg as EntityClass;

        // 2. Guardamos la configuración. La inferencia la hará la capa de relaciones.
        const relationConfig: any = {
            targetEntity: targetEntityFn,
            options,
            isMany: true,
            propertyName
        };

        Reflect.defineMetadata(SHEETS_ALL_RELATIONS, relationConfig, target, propertyName);

        const relationsList: string[] = Reflect.getMetadata(SHEETS_RELATIONS_LIST, target) || [];
        if (!relationsList.includes(propertyName)) {
            relationsList.push(propertyName);
            Reflect.defineMetadata(SHEETS_RELATIONS_LIST, relationsList, target);
        }
    };
}
