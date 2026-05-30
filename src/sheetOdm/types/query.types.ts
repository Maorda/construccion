export type ClassType<T = any> = new (...args: any[]) => T;

export type Projection<T = any> = {
    [P in keyof T]?: boolean | number;
} | Record<string, any>;



export interface IQueryEngine {
    execute<T extends object>(
        data: T[],
        filter: FilterQuery<T>, // Ahora es fuertemente tipado
        options?: QueryOptions
    ): Promise<any[]>;
    aggregate<T extends object>(data: T[], pipeline: any[]): Promise<any[]>;
}

// Tipo auxiliar para las opciones de consulta
export interface QueryOptions<T = any> {
    projection?: Projection<T>;
    limit?: number;
    offset?: number;
    sort?: { field: string; order: 'ASC' | 'DESC' };
    includeInactive?: boolean; // Control de Soft Delete
    skip?: number;
}

export type ComparisonOperators<T> = {
    $eq?: T;
    $gt?: T;
    $gte?: T;
    $lt?: T;
    $lte?: T;
    $in?: T[];
    $nin?: T[];
    $ne?: T;
    $exists?: boolean;
    $regex?: string;
};

// FilterQuery: Permite filtrar por cualquier propiedad de la Entidad T o expresiones complejas
export type FilterQuery<T = any> = {
    [P in keyof T]?: T[P] | ComparisonOperators<T[P]>;
} & Record<string, any>;

// UpdateQuery: Permite realizar actualizaciones a las propiedades de T
export type UpdateQuery<T> = {
    [P in keyof T]?: T[P];
} & {
    $set?: Partial<T>;
    $inc?: Partial<Record<keyof T, number>>; // Para contadores
    $push?: Record<string, any>;
};

/**
 * Representa un Pipeline de Agregación destinado a operaciones de mutación/escritura.
 */
export type UpdateAggregationPipeline = Record<string, any>[];

export interface UpdateOptions {
    upsert?: boolean;
    new?: boolean; // true para retornar el documento actualizado, false para el anterior
}
