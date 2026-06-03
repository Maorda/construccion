// table.decorator.ts
import 'reflect-metadata';
import { TableOptions } from './interfacesDecorators';
import { ClassType } from '@sheetOdm/types/query.types';
import { SHEETS_DTO, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
// --- DECORADOR @Table ---
export function Table(options: TableOptions): ClassDecorator;
export function Table(name: string, options: TableOptions): ClassDecorator;
export function Table(nameOrOptions: string | TableOptions, options?: TableOptions): ClassDecorator {
    return (target: Function) => {
        const classConstructor = target as ClassType<any>;
        const name = typeof nameOrOptions === 'string' ? nameOrOptions : undefined;
        const finalOptions = typeof nameOrOptions === 'object' ? nameOrOptions : options!;

        let finalName = name ? name.toUpperCase() : `${target.name.replace(/(Entity|Model|Schema)$/i, '')}S`.toUpperCase();

        Reflect.defineMetadata(SHEETS_TABLE_NAME, finalName, classConstructor);

        if (finalOptions?.dto) {
            Reflect.defineMetadata(SHEETS_DTO, finalOptions.dto, classConstructor);
        } else {
            throw new Error(`[ODM Decorator Error] La entidad ${target.name} requiere un DTO en @Table.`);
        }

        MetadataRegistry.register(classConstructor);
    };
}