import 'reflect-metadata';
import { ClassType } from '@sheetOdm/types/query.types';

// Interfaces de configuración de decoradores
export interface ColumnOptions {
    name?: string;
    type?: 'string' | 'number' | 'boolean' | 'date' | 'currency' | 'json' | 'array' | any;
    required?: boolean;
    default?: any;
    isDeleteControl?: boolean;
    isAutoIncrement?: boolean;
    generated?: 'uuid' | 'short-id' | 'increment';
    validation?: Record<string, any>;
}

export interface ReferenceOptions {
    joinColumn: string;
    required?: boolean;
    onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
}

export interface SubCollectionOptions {
    onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
    joinColumn?: string;
    localField?: string;
    cascadeDelete: boolean;
}

export interface VirtualOptions {
    group: string;
}

export interface TableOptions {
    dto: ClassType<any>;
}