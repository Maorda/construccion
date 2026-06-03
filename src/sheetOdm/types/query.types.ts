import { GroupConfig, LookupConfig } from "@sheetOdm/pipelines/types";
import { SheetsRepository } from "@sheetOdm/repository/sheets.repository";
import { SheetDocument } from "@sheetOdm/wrapper/sheetDocument";

export type ClassType<T = any> = new (...args: any[]) => T;

export type Projection<T = any> = {
    [P in keyof T]?: boolean | number;
} | Record<string, any>;

export interface ISheetDriver {
    appendRow(sheetName: string, row: any[]): Promise<number>;
    updateRow(sheetName: string, rowNumber: number, values: any[]): Promise<number>;
    getExistingSheetTitles(): Promise<string[]>;
    createSheet(title: string): Promise<any>;
    writeHeaders(sheetName: string, headers: string[]): Promise<any>;
    getRange(range: string): Promise<any[][]>;
}

export type ConstructorSignature<T, U> = new (
    data: T,
    repo: any, // Usamos any aquí para romper la dependencia circular
    isNew: boolean,
    ...args: any[]
) => U;

export interface FindOneAndUpdateOptions<T extends object, U = any> extends QueryOptions<T> {
    upsert?: boolean;
    new?: boolean;
    // Sobrescribimos con el tipo específico U si es necesario
    customConstructor?: ConstructorSignature<T, U>;
}


export interface IQueryEngine {
    execute<T>(data: T[], filter: FilterQuery<T>, options?: QueryOptions): Promise<T[]>;
    aggregate<R = any>(data: any[], pipeline: AggregationPipeline): Promise<R[]>;
}

// Tipo auxiliar para las opciones de consulta
export interface QueryOptions<T = any> {
    projection?: Projection<T>;
    limit?: number;
    offset?: number;
    sort?: { field: string; order: 'ASC' | 'DESC' };
    includeInactive?: boolean; // Control de Soft Delete
    skip?: number;
    forceRefresh?: boolean;
    customConstructor?: ConstructorSignature<T, any>;
}
export type PipelineStage =
    | { $match: Record<string, any> }
    | { $lookup: LookupConfig }
    | { $unwind: string | { path: string; preserveNullAndEmptyArrays?: boolean } }
    | { $project: Record<string, any> }
    | { $addFields: Record<string, any> }
    | { $group: GroupConfig }
    | { $sort: Record<string, 1 | -1> }
    | { $limit: number }
    | { $skip: number };

export type AggregationPipeline = PipelineStage[];

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
// Primero, definimos las reglas de consulta para cada campo
export type FieldFilter<T> = T | ComparisonOperators<T>;

// Luego, la estructura del FilterQuery
export type FilterQuery<T = any> = {
    // 1. Filtros estándar (acceso a propiedades de T)
    [P in keyof T]?: FieldFilter<T[P]>;
} & {
    // 2. Operadores Lógicos (que no son campos de T, pero son permitidos)
    $or?: FilterQuery<T>[];
    $and?: FilterQuery<T>[];
    $nor?: FilterQuery<T>[];

    // 3. (Opcional) Si tu motor de consultas soporta flags globales o metadatos en el query
    // $comment?: string;
    // $hint?: any;
} & {
    // Solo si es estrictamente necesario, y con una advertencia
    [key: string]: any;
};

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
