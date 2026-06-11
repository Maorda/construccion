import 'reflect-metadata';
import { ClassType } from '@sheetOdm/types/query.types.js';
import { ReferenceOptions } from './interfacesDecorators.js';
import { SHEETS_ALL_RELATIONS, SHEETS_RELATIONS_LIST } from '@sheetOdm/constants/metadata.constants.js';
import { Column } from './column.decorator.js';
export function Reference(targetEntity: (() => ClassType<any>) | ClassType<any>, options: ReferenceOptions): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        const classConstructor = target.constructor;
        const propertyName = propertyKey.toString();
        const targetEntityFn = typeof targetEntity === 'function' && !targetEntity.prototype
            ? (targetEntity as () => ClassType<any>)
            : () => targetEntity as ClassType<any>;

        const relationConfig = {
            targetEntity: targetEntityFn,
            isMany: false,
            type: 'reference',
            joinColumn: options.joinColumn,
            required: options.required ?? false,
            onDelete: options.onDelete || 'RESTRICT',
            propertyName
        };

        let relationsList = Reflect.getOwnMetadata(SHEETS_RELATIONS_LIST, target);
        if (!relationsList) {
            relationsList = [...(Reflect.getMetadata(SHEETS_RELATIONS_LIST, target) || [])];
        }
        if (!relationsList.includes(propertyName)) {
            relationsList.push(propertyName);
            Reflect.defineMetadata(SHEETS_RELATIONS_LIST, relationsList, target);
        }

        Reflect.defineMetadata(SHEETS_ALL_RELATIONS, relationConfig, target, propertyName);

        // Auto-inyección de columna física FK
        Column({ name: options.joinColumn, type: 'string', required: options.required })(target, options.joinColumn);
    };
}