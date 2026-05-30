import 'reflect-metadata';
import {
    SHEETS_COLUMN_DETAILS,
    SHEETS_COLUMN_LIST,
    SHEETS_DELETE_CONTROL,
    TABLE_COLUMN_KEY,
} from '@sheetOdm/constants/metadata.constants';

export interface ColumnOptions {
    /** Nombre de la cabecera física real en la pestaña de Google Sheets */
    name?: string;

    /**
     * Tipo de dato para validación, formateo e hidratación.
     * Se añaden 'json' y 'array' para serialización automática de datos complejos.
     */
    type?: 'string' | 'number' | 'boolean' | 'date' | 'currency' | 'json' | 'array' | any;

    /** Si es true, el motor de validación impedirá almacenar valores nulos o vacíos */
    required?: boolean;

    /** Valor por defecto asignado automáticamente si la propiedad llega como undefined o null */
    default?: any;

    /** Identifica la propiedad que controla el borrado lógico (Soft Delete) */
    isDeleteControl?: boolean;

    /** Marca la columna como autoincrementable pura en secuencia (1, 2, 3...) */
    isAutoIncrement?: boolean;

    /** Estrategia de generación automatizada de claves al insertar registros */
    generated?: 'uuid' | 'short-id' | 'increment';
}

/**
 * Decorador @Column
 * Registra y estructura las propiedades de la entidad convirtiéndolas en celdas para el ecosistema Google Sheets.
 */
export function Column(options: ColumnOptions = {}): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        const classConstructor = target.constructor;
        const propString = propertyKey.toString();

        // 1. SOLUCIÓN AL BUG: Usamos getOwnMetadata y clonamos para evitar mutar al Padre
        let columnsList = Reflect.getOwnMetadata(SHEETS_COLUMN_LIST, classConstructor);
        if (!columnsList) {
            // Si el padre tiene columnas, las heredamos clonando el array
            const parentColumns = Reflect.getMetadata(SHEETS_COLUMN_LIST, classConstructor) || [];
            columnsList = [...parentColumns];
        }

        if (!columnsList.includes(propString)) {
            columnsList.push(propString);
            Reflect.defineMetadata(SHEETS_COLUMN_LIST, columnsList, classConstructor);
        }

        // 2. Normalización de la Configuración
        const config: ColumnOptions = {
            name: options.name || propString,
            type: options.type || 'string',
            required: options.required ?? false,
            default: options.default ?? null,
            isDeleteControl: options.isDeleteControl || false,
            isAutoIncrement: options.isAutoIncrement || (options.generated === 'increment'),
            generated: options.generated
        };

        // 3. Centralización de detalles en el Constructor (Única fuente de verdad)
        let details = Reflect.getOwnMetadata(SHEETS_COLUMN_DETAILS, classConstructor);
        if (!details) {
            const parentDetails = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, classConstructor) || {};
            details = { ...parentDetails };
        }
        details[propString] = config;
        Reflect.defineMetadata(SHEETS_COLUMN_DETAILS, details, classConstructor);

        // 4. Optimizador de accesos rápidos
        if (config.isDeleteControl) {
            Reflect.defineMetadata(SHEETS_DELETE_CONTROL, propString, classConstructor);
        }
    };
}
