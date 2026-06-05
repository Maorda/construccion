import { Injectable, Logger } from "@nestjs/common";
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import weekOfYear from 'dayjs/plugin/weekOfYear';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(weekOfYear);

@Injectable()
export class ExpressionEngine {
    private readonly logger = new Logger(ExpressionEngine.name);

    /**
     * 🟢 REGISTRO CENTRAL DE OPERADORES
     */
    private readonly operatorsRegistry: Record<string, (args: any, record: any) => any> = {
        // 1. LÓGICOS Y COMPARACIÓN
        '$eq': (args, record) => this.evaluate(args.val1, record) === this.evaluate(args.val2, record),
        '$ne': (args, record) => this.evaluate(args.val1, record) !== this.evaluate(args.val2, record),
        '$gt': (args, record) => Number(this.evaluate(args.val1, record)) > Number(this.evaluate(args.val2, record)),
        '$gte': (args, record) => Number(this.evaluate(args.val1, record)) >= Number(this.evaluate(args.val2, record)),
        '$lt': (args, record) => Number(this.evaluate(args.val1, record)) < Number(this.evaluate(args.val2, record)),
        '$lte': (args, record) => Number(this.evaluate(args.val1, record)) <= Number(this.evaluate(args.val2, record)),
        '$in': (args, record) => {
            const val = this.evaluate(args.val1, record);
            const arr = this.evaluate(args.val2, record);
            return Array.isArray(arr) ? arr.some(item => String(item).trim() === String(val).trim()) : false;
        },
        '$nin': (args, record) => !this.operatorsRegistry['$in'](args, record),
        '$exists': (args, record) => {
            const val = this.evaluate(args.val, record);
            return val !== undefined && val !== null && String(val).trim() !== '';
        },
        '$regex': (args, record) => {
            const val = String(this.evaluate(args.val, record) || '');
            const pattern = this.evaluate(args.pattern, record);
            return new RegExp(pattern, 'i').test(val);
        },
        '$if': (args, record) => {
            const condition = this.evaluate(args.if, record);
            return condition ? this.evaluate(args.then, record) : this.evaluate(args.else, record);
        },

        // 2. MATEMÁTICOS
        '$multiply': (args, record) => {
            const values = Array.isArray(args.values) ? args.values : [];
            return values.reduce((acc, curr) => acc * (Number(this.evaluate(curr, record)) || 0), 1);
        },
        '$inc': (args, record) => Number(this.evaluate(args.current, record) || 0) + Number(this.evaluate(args.val, record) || 0),
        '$minMax': (args, record) => {
            const current = this.evaluate(args.current, record);
            const target = Number(this.evaluate(args.target ?? 0, record));
            const type = args.type || 'sum';
            if (current === undefined || current === null || current === '' || isNaN(Number(current))) return target;
            return type === 'min' ? Math.min(Number(current), target) : Math.max(Number(current), target);
        },
        '$round': (args, record) => {
            const val = parseFloat(this.evaluate(args.value, record));
            const decimals = Number(this.evaluate(args.decimals ?? 2, record));
            if (isNaN(val)) return 0;
            const factor = Math.pow(10, decimals);
            return Math.round(val * factor) / factor;
        },
        '$math': (args, record) => {
            const expression = this.evaluate(args.expression, record);
            if (!expression || typeof expression !== 'string') return 0;
            try {
                const rawData = this.extractRawData(record);
                const resolved = expression.replace(/\$([a-zA-Z0-9_]+)/g, (_, field) => `(${Number(rawData?.[field] ?? 0)})`);
                return Function(`"use strict"; return (${resolved.replace(/[^0-9+\-*/().\s,Mathabsroundceilfloor-]/g, '')})`)();
            } catch { return 0; }
        },

        // 3. CADENAS
        '$upper': (args, record) => String(this.evaluate(args.val, record) || '').toUpperCase(),
        '$trim': (args, record) => String(this.evaluate(args.val, record) || '').trim(),
        '$concat': (args, record) => (Array.isArray(args.parts) ? args.parts : [args.parts]).map(p => String(this.evaluate(p, record) ?? '')).join(''),

        // 4. TIEMPO
        '$year': (args, record) => this.safeDayjs(this.evaluate(args.val, record))?.year() || 0,
        '$month': (args, record) => (this.safeDayjs(this.evaluate(args.val, record))?.month() || -1) + 1,
        '$day': (args, record) => this.safeDayjs(this.evaluate(args.val, record))?.date() || 0,
        '$dateAdd': (args, record) => {
            const d = this.safeDayjs(this.evaluate(args.startDate, record));
            return d ? d.add(Number(args.amount), args.unit ?? 'day').format('YYYY-MM-DD HH:mm:ss') : '';
        },
        '$timeDiff': (args, record) => {
            const start = dayjs(this.evaluate(args.start, record));
            const end = dayjs(this.evaluate(args.end, record));
            if (!start.isValid() || !end.isValid()) return 0;
            return Math.round(end.diff(start, args.unit ?? 'hour', true) * 100) / 100;
        },

        // 5. COLECCIONES
        '$aggregate': (args, record) => {
            const values = (Array.isArray(args.values) ? args.values : []).map(v => this.evaluate(v, record));
            const type = args.type || 'sum';
            const nums = values.map(v => typeof v === 'string' ? parseFloat(v.replace(/[S\/\.\$\s,]/g, '')) : v).filter(n => !isNaN(n));
            if (nums.length === 0) return 0;
            const sum = nums.reduce((a, b) => a + b, 0);
            switch (type) {
                case 'sum': return sum;
                case 'avg': return sum / nums.length;
                case 'count': return nums.length;
                case 'min': return Math.min(...nums);
                case 'max': return Math.max(...nums);
                default: return sum;
            }
        }
    };

    public execute(record: any, projection: any): any {
        if (!projection || typeof projection !== 'object') return projection;
        if (!record) return {};
        if (Array.isArray(projection)) return projection.map(item => this.execute(record, item));

        const result: any = {};
        for (const key in projection) {
            const expression = projection[key];
            if (this.isOperatorObject(expression)) {
                const operatorKey = Object.keys(expression)[0];
                result[key] = this.runOperator(operatorKey, expression[operatorKey], record);
            } else {
                result[key] = this.evaluate(expression, record);
            }
        }
        return result;
    }

    public evaluate(expression: any, record: any): any {
        if (typeof expression === 'string' && expression.startsWith('$')) {
            const fieldName = expression.substring(1);
            // ✅ CORRECCIÓN: Desempaquetado del Wrapper antes de interrogar las propiedades del registro
            const rawData = this.extractRawData(record);
            return rawData && rawData.hasOwnProperty(fieldName) ? rawData[fieldName] : null;
        }

        if (expression && typeof expression === 'object' && !Array.isArray(expression)) {
            const operator = Object.keys(expression).find(key => key.startsWith('$'));
            if (operator) {
                return this.runOperator(operator, expression[operator], record);
            }
            const resolvedObj: any = {};
            for (const k in expression) {
                resolvedObj[k] = this.evaluate(expression[k], record);
            }
            return resolvedObj;
        }

        return expression;
    }
    public getNestedValue(obj: any, path: string): any {
        if (!obj || !path) return undefined;
        return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
    }
    public evaluateFilter(record: any, filter: Record<string, any>): boolean {
        const rawData = this.extractRawData(record);
        if (!filter || typeof filter !== 'object') return true;

        return Object.entries(filter).every(([key, condition]) => {
            // A. Manejo de Operadores Lógicos (Recursivos)
            if (key === '$and') return (condition as any[]).every(f => this.evaluateFilter(rawData, f));
            if (key === '$or') return (condition as any[]).some(f => this.evaluateFilter(rawData, f));
            if (key === '$nor') return !(condition as any[]).some(f => this.evaluateFilter(rawData, f));
            if (key === '$not') return !this.evaluateFilter(rawData, condition);

            // B. Manejo de Campo (Acceso a dato y Comparación)
            const value = this.getNestedValue(rawData, key);
            return this.compareValue(value, condition);
        });
    }

    private runOperator(op: string, config: any, record: any): any {
        const handler = this.operatorsRegistry[op];
        if (!handler) return null;

        // Esquemas posicionales para los operadores que los necesitan
        const schemas: Record<string, string[]> = {
            '$eq': ['val1', 'val2'], '$ne': ['val1', 'val2'],
            '$gt': ['val1', 'val2'], '$gte': ['val1', 'val2'],
            '$lt': ['val1', 'val2'], '$lte': ['val1', 'val2'],
            '$in': ['val1', 'val2'], '$nin': ['val1', 'val2'],
            '$regex': ['val', 'pattern'], '$round': ['value', 'decimals'],
            '$inc': ['current', 'val'], '$dateAdd': ['startDate', 'amount', 'unit']
        };

        // Normalización: Si es array, lo convertimos a objeto usando el esquema
        let args = config;
        if (Array.isArray(config) && schemas[op]) {
            args = schemas[op].reduce((acc, key, i) => ({ ...acc, [key]: config[i] }), {});
        } else if (!Array.isArray(config) && typeof config !== 'object') {
            // Caso de valor único (ej: $upper: "TEXTO")
            args = { val: config };
        }

        return handler(args, record);
    }

    private isOperatorObject(obj: any): boolean {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
        const keys = Object.keys(obj);
        return keys.length === 1 && keys[0].startsWith('$');
    }

    // ✅ HELPER: Desempaquetado seguro de wrappers del ODM
    private extractRawData(item: any): any {
        return item?.data ?? item?._snapshot ?? item;
    }

    // ✅ HELPER: Previene falsos positivos del año actual ante campos vacíos/undefined
    private safeDayjs(val: any): dayjs.Dayjs | null {
        if (val === undefined || val === null || String(val).trim() === '') return null;
        const d = dayjs(val);
        return d.isValid() ? d : null;
    }
    private normalizeArgs(config: any, schema: string[]): Record<string, any> {
        // Si es un objeto, ya está normalizado
        if (typeof config === 'object' && !Array.isArray(config)) return config;

        // Si es un array, lo mapeamos al esquema de nombres esperado
        if (Array.isArray(config)) {
            return schema.reduce((acc, key, index) => {
                acc[key] = config[index];
                return acc;
            }, {} as Record<string, any>);
        }

        // Si es un valor simple (ej: $round: 5), lo devolvemos como el primer argumento
        return { value: config };
    }
    private compareValue(fieldValue: any, condition: any): boolean {
        // Caso: Igualdad directa (ej: { status: 'ACTIVO' })
        if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
            return fieldValue === condition;
        }

        // Caso: Operadores (ej: { $gt: 10 })
        return Object.entries(condition).every(([operator, targetValue]) => {
            if (operator === '$options') return true; // Se maneja dentro de $regex
            if (!operator.startsWith('$')) return fieldValue === targetValue;

            // Preparamos argumentos para el Registry
            const args = {
                val1: fieldValue,
                val2: targetValue,
                val: fieldValue,
                pattern: targetValue,
                options: condition['$options'] || 'i'
            };

            return this.runOperator(operator, args, {});
        });
    }
}