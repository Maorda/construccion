import 'reflect-metadata';
import { SHEETS_DTO, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';


export interface TableOptions {
    dto?: new (...args: any[]) => any;
}
// 1. Firma cuando solo pasan el DTO (nombre autogenerado)
export function Table(options: TableOptions): ClassDecorator;

// 2. Firma cuando pasan el nombre y el DTO
export function Table(name: string, options: TableOptions): ClassDecorator;

export function Table(nameOrOptions: string | TableOptions, options?: TableOptions): ClassDecorator {
    return (target: Function) => {
        const name = typeof nameOrOptions === 'string' ? nameOrOptions : undefined;
        const finalOptions = typeof nameOrOptions === 'object' ? nameOrOptions : options!;
        // 1. Lógica de nombrado (tu lógica actual)
        //const finalOptions = options || {};
        let finalName: string;
        if (name) {
            finalName = name.toUpperCase();
        } else {
            const baseName = target.name.replace(/(Entity|Model|Schema)$/i, '');
            // ... (tu lógica de pluralización) ...
            finalName = `${baseName}S`.toUpperCase(); // Simplificado para el ejemplo
        }

        // 2. Definir metadata
        Reflect.defineMetadata(SHEETS_TABLE_NAME, finalName, target);
        if (finalOptions.dto) {
            Reflect.defineMetadata(SHEETS_DTO, finalOptions.dto, target);
        }

        // 3. REGISTRO ACTIVO: Avisamos al registry que esta clase existe
        MetadataRegistry.register(target);
    };
}
