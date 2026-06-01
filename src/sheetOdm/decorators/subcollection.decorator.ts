import 'reflect-metadata';
import {
    SHEETS_ALL_RELATIONS,
    SHEETS_RELATIONS_LIST
} from '@sheetOdm/constants/metadata.constants';


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

        const targetEntityFn = typeof arg === 'function' && !arg.prototype
            ? (arg as () => EntityClass)
            : () => arg as EntityClass;

        const relationConfig = {
            targetEntity: targetEntityFn,
            options,
            isMany: true,
            propertyName
        };

        Reflect.defineMetadata(SHEETS_ALL_RELATIONS, relationConfig, target, propertyName);

        // 🔥 CORRECCIÓN: Clonación segura con getOwnMetadata para evitar fugas entre entidades heredadas
        let relationsList = Reflect.getOwnMetadata(SHEETS_RELATIONS_LIST, target);
        if (!relationsList) {
            const parentList = Reflect.getMetadata(SHEETS_RELATIONS_LIST, target) || [];
            relationsList = [...parentList];
        }
        if (!relationsList.includes(propertyName)) {
            relationsList.push(propertyName);
            Reflect.defineMetadata(SHEETS_RELATIONS_LIST, relationsList, target);
        }
    };
}