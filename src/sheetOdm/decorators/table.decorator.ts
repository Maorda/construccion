// table.decorator.ts
import 'reflect-metadata';
import { SHEETS_DTO, SHEETS_TABLE_NAME } from '@sheetOdm/constants/metadata.constants';
import { MetadataRegistry } from '@sheetOdm/services/metadata-registry.service';
import { ClassType } from '@sheetOdm/types/query.types';

export interface TableOptions {
    dto: ClassType<any>; // 🎯 Forzamos a que el DTO sea una clase instanciable obligatoria
}

// Sobrecargas de firma limpias
export function Table(options: TableOptions): ClassDecorator;
export function Table(name: string, options: TableOptions): ClassDecorator;

export function Table(nameOrOptions: string | TableOptions, options?: TableOptions): ClassDecorator {
    return (target: Function) => {
        const classConstructor = target as ClassType<any>; // 🛡️ Casteo seguro a nuestro tipo global de clases

        const name = typeof nameOrOptions === 'string' ? nameOrOptions : undefined;
        const finalOptions = typeof nameOrOptions === 'object' ? nameOrOptions : options!;

        // 1. Estrategia de Nombramiento automático inteligente
        let finalName: string;
        if (name) {
            finalName = name.toUpperCase();
        } else {
            // Remueve sufijos comunes del archivo físico (ej: UsuarioEntity -> USUARIOS)
            const baseName = target.name.replace(/(Entity|Model|Schema)$/i, '');
            finalName = `${baseName}S`.toUpperCase();
        }

        // 2. Definir los metadatos en el Constructor de la Clase
        Reflect.defineMetadata(SHEETS_TABLE_NAME, finalName, classConstructor);

        if (finalOptions && finalOptions.dto) {
            Reflect.defineMetadata(SHEETS_DTO, finalOptions.dto, classConstructor);
        } else {
            throw new Error(`[ODM Decorator Error] La entidad ${target.name} requiere pasar un DTO válido en las opciones de @Table.`);
        }

        // 3. REGISTRO ACTIVO AUTOMÁTICO
        // Almacena la clase en el Store global para que el `DatabaseConfigService` la descubra en el arranque
        MetadataRegistry.register(classConstructor);
    };
}
