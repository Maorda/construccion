// en @sheetOdm/decorators/reference.decorator.ts
import 'reflect-metadata';
import {
    SHEETS_ALL_RELATIONS,
    SHEETS_RELATIONS_LIST,
    SHEETS_COLUMN_LIST,
    SHEETS_COLUMN_DETAILS,
} from '@sheetOdm/constants/metadata.constants';

type EntityClass = new () => any;

export interface ReferenceOptions {
    /** * OBLIGATORIO: El nombre de la columna física en Google Sheets 
     * que guardará el ID del registro padre (ej. 'proyectoId' u 'obreroId')
     */
    joinColumn: string;

    /** Indica si el motor debe lanzar error si se intenta guardar sin esta relación */
    required?: boolean;

    /** * Opcional: Define qué pasa con este registro si se borra el padre.
     * Aunque normalmente esto se define en el @SubCollection del padre, 
     * tenerlo aquí permite validaciones inversas en el PersistenceEngine.
     */
    onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
}

export function Reference(
    targetEntity: EntityClass | (() => EntityClass),
    options: ReferenceOptions
): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        const classConstructor = target.constructor;
        const propertyName = propertyKey.toString();

        // 1. Resolver el targetEntity (soporta funciones diferidas para evitar referencias circulares)
        const targetEntityFn = typeof targetEntity === 'function' && !targetEntity.prototype
            ? (targetEntity as () => EntityClass)
            : () => targetEntity as EntityClass;

        // 2. Configuración de la Relación (Lado Hijo)
        const relationConfig = {
            targetEntity: targetEntityFn,
            isMany: false, // Es una relación 1 a 1 (pertenece a un padre)
            type: 'reference',
            joinColumn: options.joinColumn,
            required: options.required ?? false,
            onDelete: options.onDelete || 'RESTRICT',
            propertyName
        };

        // 3. REGISTRO DE RELACIÓN (A salvo de bugs de herencia)
        let relationsList = Reflect.getOwnMetadata(SHEETS_RELATIONS_LIST, classConstructor);
        if (!relationsList) {
            const parentList = Reflect.getMetadata(SHEETS_RELATIONS_LIST, classConstructor) || [];
            relationsList = [...parentList];
        }
        if (!relationsList.includes(propertyName)) {
            relationsList.push(propertyName);
            Reflect.defineMetadata(SHEETS_RELATIONS_LIST, relationsList, classConstructor);
        }

        // Metadato individual de la propiedad relacional
        Reflect.defineMetadata(SHEETS_ALL_RELATIONS, relationConfig, target, propertyName);

        // ----------------------------------------------------------------------
        // 🚀 MAGIA AUTOMÁTICA: Registrar el `joinColumn` como una columna física
        // ----------------------------------------------------------------------
        // Para que Google Sheets sepa que tiene que guardar el ID, el joinColumn 
        // necesita existir en la lista de columnas como un string. Lo inyectamos 
        // automáticamente para que el desarrollador no tenga que escribir @Column() extra.

        let columnsList = Reflect.getOwnMetadata(SHEETS_COLUMN_LIST, classConstructor);
        if (!columnsList) {
            const parentCols = Reflect.getMetadata(SHEETS_COLUMN_LIST, classConstructor) || [];
            columnsList = [...parentCols];
        }

        if (!columnsList.includes(options.joinColumn)) {
            columnsList.push(options.joinColumn);
            Reflect.defineMetadata(SHEETS_COLUMN_LIST, columnsList, classConstructor);

            // Registramos sus detalles para el motor de persistencia
            const details = Reflect.getOwnMetadata(SHEETS_COLUMN_DETAILS, classConstructor) || {};
            details[options.joinColumn] = {
                name: options.joinColumn,
                type: 'string', // Los IDs suelen ser strings o UUIDs
                required: options.required ?? false,
                isDeleteControl: false,
                isAutoIncrement: false
            };
            Reflect.defineMetadata(SHEETS_COLUMN_DETAILS, details, classConstructor);
        }
    };
}