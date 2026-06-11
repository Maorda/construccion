import 'reflect-metadata';
import { ClassType } from '@sheetOdm/types/query.types.js';
import { SubCollectionOptions } from './interfacesDecorators.js';
import { SHEETS_ALL_RELATIONS, SHEETS_RELATIONS_LIST } from '@sheetOdm/constants/metadata.constants.js';
export function SubCollection(arg: (() => ClassType<any>) | ClassType<any>, options?: SubCollectionOptions): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        const propertyName = propertyKey.toString();
        const targetEntityFn = typeof arg === 'function' && !arg.prototype
            ? (arg as () => ClassType<any>)
            : () => arg as ClassType<any>;

        const relationConfig = {
            targetEntity: targetEntityFn,
            options,
            isMany: true,
            propertyName
        };

        Reflect.defineMetadata(SHEETS_ALL_RELATIONS, relationConfig, target, propertyName);

        let relationsList = Reflect.getOwnMetadata(SHEETS_RELATIONS_LIST, target);
        if (!relationsList) {
            relationsList = [...(Reflect.getMetadata(SHEETS_RELATIONS_LIST, target) || [])];
        }
        if (!relationsList.includes(propertyName)) {
            relationsList.push(propertyName);
            Reflect.defineMetadata(SHEETS_RELATIONS_LIST, relationsList, target);
        }
    };
}