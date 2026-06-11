import { ClassType } from "@sheetOdm/types/query.types";

/**
 * Configuración para la etapa de agrupación.
 */
export interface GroupConfig {
    /** Campo por el cual agrupar. Debe empezar con "$" (ej: "$id_obra") o ser null para agrupar todo */
    _id: string | null;

    /** Campos acumuladores dinámicos */
    [key: string]: GroupAccumulator | string | null;
}
/**
 * Configuración para la etapa de cruce de hojas (Join).
 */
export interface LookupConfig {
    /** Nombre de la entidad/hoja destino (ej: 'Peon') */
    from: string;

    /** Campo en la entidad actual que sirve de llave (ej: 'especialistaId') */
    localField: string;

    /** Campo en la entidad destino que coincide con localField (ej: 'id') */
    foreignField: string;

    /** Nombre del nuevo campo donde se guardará el resultado (normalmente un arreglo) */
    as: string;
}

/**
 * Operadores permitidos dentro de una etapa $group.
 */
export interface GroupAccumulator {
    $sum?: string | number | any;   // Puede ser "$campo" o una expresión recursiva
    $avg?: string | any;
    $min?: string | any;
    $max?: string | any;
    $count?: Record<string, never>; // Objeto vacío {}
    $push?: string | any;
}

export interface RelationOptions {
    // La función que retorna la entidad relacionada (ej: () => User)
    targetEntity: () => ClassType<any>;

    // El tipo de relación
    type: 'OneToOne' | 'OneToMany' | 'ManyToOne' | 'ManyToMany';

    // Nombre de la columna que guarda la llave foránea (opcional)
    joinColumn?: string;

    // El nombre de la propiedad en la entidad contraria (opcional, para relaciones bidireccionales)
    inverseSide?: string;

    // Si al guardar/borrar esta entidad, la acción se propaga a las relacionadas
    cascade?: boolean;
}