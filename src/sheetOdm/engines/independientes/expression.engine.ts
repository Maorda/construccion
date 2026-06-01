import { Injectable, Logger } from '@nestjs/common';

import dayjs from 'dayjs';
// Usamos require para evitar el error de compilación de módulos, 
// pero mantenemos la lógica de tipos de Day.js
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { ModuleRef } from '@nestjs/core';
// Extendemos dayjs
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
// 2. EXTIENDE EL PLUGIN AQUÍ
dayjs.extend(weekOfYear);
@Injectable()
export class ExpressionEngine {
    private readonly logger = new Logger(ExpressionEngine.name);
    constructor(
        private readonly compareEngine: CompareEngine,
        private readonly moduleRef: ModuleRef,
    ) { }
    /**
     * 🟢 MÉTODO PRINCIPAL (PUNTO DE ENTRADA DE PROYECCIONES)
     * Evalúa un registro en base a un mapa de transformaciones.
     */
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

    private isOperatorObject(obj: any): boolean {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
        const keys = Object.keys(obj);
        return keys.length === 1 && keys[0].startsWith('$');
    }

    /**
     * Evalúa condiciones lógicas completas ($and, $or, etc.) para etapas de filtrado ($match).
     */
    evaluateFilter<T extends object>(item: T, filter: any): boolean {
        if (!filter || Object.keys(filter).length === 0) {
            return true;
        }

        for (const key of Object.keys(filter)) {
            const condition = filter[key];

            if (key === '$and') {
                if (!Array.isArray(condition)) return false;
                if (!condition.every(subFilter => this.evaluateFilter(item, subFilter))) return false;
                continue;
            }

            if (key === '$or') {
                if (!Array.isArray(condition)) return false;
                if (!condition.some(subFilter => this.evaluateFilter(item, subFilter))) return false;
                continue;
            }

            if (key === '$nor') {
                if (!Array.isArray(condition)) return false;
                if (condition.some(subFilter => this.evaluateFilter(item, subFilter))) return false;
                continue;
            }

            if (key === '$not') {
                if (typeof condition !== 'object') return false;
                if (this.evaluateFilter(item, condition)) return false;
                continue;
            }

            const value = this.getNestedValue(item, key);
            if (!this.compareEngine.evaluateValue(value, condition)) {
                return false;
            }
        }

        return true;
    }

    private getNestedValue(obj: any, path: string): any {
        if (!obj) return undefined;
        if (!path.includes('.')) return obj[path];

        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[part];
        }
        return current;
    }

    public evaluate(expression: any, record: any): any {
        if (typeof expression === 'string' && expression.startsWith('$')) {
            const fieldName = expression.substring(1);
            return record && record.hasOwnProperty(fieldName) ? record[fieldName] : null;
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

    private runOperator(op: string, config: any, record: any): any {
        const handler = this.operatorsRegistry[op];
        if (!handler) {
            this.logger.warn(`[ExpressionEngine] Operador no soportado o inexistente: [${op}]`);
            return null;
        }
        return handler(config, record);
    }

    private readonly operatorsRegistry: Record<string, (config: any, record: any) => any> = {
        // Lógicos y Comparación
        '$eq': (config, record) => this.evaluate(config[0], record) === this.evaluate(config[1], record),
        '$ne': (config, record) => this.evaluate(config[0], record) !== this.evaluate(config[1], record),
        '$gt': (config, record) => Number(this.evaluate(config[0], record)) > Number(this.evaluate(config[1], record)),
        '$gte': (config, record) => Number(this.evaluate(config[0], record)) >= Number(this.evaluate(config[1], record)),
        '$lt': (config, record) => Number(this.evaluate(config[0], record)) < Number(this.evaluate(config[1], record)),
        '$lte': (config, record) => Number(this.evaluate(config[0], record)) <= Number(this.evaluate(config[1], record)),

        '$in': (config, record) => {
            const val = this.evaluate(config[0], record);
            const arr = this.evaluate(config[1], record);
            return Array.isArray(arr) ? arr.some(item => String(item).trim() === String(val).trim()) : false;
        },
        '$nin': (config, record) => !this.operatorsRegistry['$in'](config, record),

        '$exists': (config, record) => {
            const val = this.evaluate(config, record);
            return val !== undefined && val !== null && String(val).trim() !== '';
        },

        '$regex': (config, record) => {
            const val = String(this.evaluate(config[0], record) || '');
            const pattern = this.evaluate(config[1], record);
            return new RegExp(pattern, 'i').test(val);
        },

        '$if': (config, record) => {
            const condition = this.evaluate(config.if ?? config[0], record);
            return condition ? this.evaluate(config.then ?? config[1], record) : this.evaluate(config.else ?? config[2], record);
        },

        // Operadores de Arreglo / Estructura (NUEVO: Para soportar conteos en relaciones)
        '$size': (config, record) => {
            const target = this.evaluate(config, record);
            return Array.isArray(target) ? target.length : 0;
        },

        // Matemáticos
        '$multiply': (config, record) => {
            if (!Array.isArray(config)) return 0;
            return config.reduce((acc, curr) => acc * (Number(this.evaluate(curr, record)) || 0), 1);
        },
        '$inc': (config, record) => {
            const base = Number(this.evaluate(config.current ?? config[0], record)) || 0;
            const val = Number(this.evaluate(config.val ?? config[1], record)) || 0;
            return base + val;
        },
        '$minMax': (config, record) => {
            const current = this.evaluate(config.current ?? config[0], record);
            const target = Number(this.evaluate(config.target ?? config[1], record) ?? 0);
            const type = this.evaluate(config.type ?? config[2], record) || 'sum';
            if (current === undefined || current === null || current === '') return target;
            const currentNum = Number(current);
            if (isNaN(currentNum)) return target;
            return type === 'min' ? Math.min(currentNum, target) : Math.max(currentNum, target);
        },
        '$round': (config, record) => {
            const val = parseFloat(this.evaluate(config.value ?? config[0], record));
            const decimals = Number(this.evaluate(config.decimals ?? config[1], record)) || 2;
            if (isNaN(val)) return 0;
            const factor = Math.pow(10, decimals);
            return Math.round(val * factor) / factor;
        },
        '$math': (config, record) => {
            const expression = this.evaluate(config, record);
            if (!expression || typeof expression !== 'string') return 0;
            try {
                const resolved = expression.replace(/\$([a-zA-Z0-9_]+)/g, (_, field) => {
                    return `(${Number(record && record[field] !== undefined ? record[field] : 0)})`;
                });
                const safeExpression = resolved.replace(/[^0-9+\-*/().\s,Mathabsroundceilfloor-]/g, '');
                return Function(`"use strict"; return (${safeExpression})`)();
            } catch (error) {
                console.error(`[MathHandler] Error: ${expression}`, error);
                return 0;
            }
        },

        // Mutadores de Cadena
        '$upper': (config, record) => String(this.evaluate(config, record) || '').toUpperCase(),
        '$trim': (config, record) => String(this.evaluate(config, record) || '').trim(),
        '$concat': (config, record) => {
            const parts = Array.isArray(config) ? config : [config];
            return parts.map(p => String(this.evaluate(p, record) ?? '')).join('');
        },

        // Fechas y Tiempo
        '$year': (config, record) => dayjs(this.evaluate(config, record)).year() || 0,
        '$month': (config, record) => dayjs(this.evaluate(config, record)).month() + 1 || 0,
        '$day': (config, record) => dayjs(this.evaluate(config, record)).date() || 0,
        '$hour': (config, record) => dayjs(this.evaluate(config, record)).hour() || 0,
        '$minute': (config, record) => dayjs(this.evaluate(config, record)).minute() || 0,
        '$second': (config, record) => dayjs(this.evaluate(config, record)).second() || 0,
        '$dayOfWeek': (config, record) => dayjs(this.evaluate(config, record)).day() + 1 || 0,
        '$week': (config, record) => dayjs(this.evaluate(config, record)).week() || 0,
        '$dateAdd': (config, record) => {
            const baseDate = this.evaluate(config.startDate ?? config[0], record);
            const amount = Number(this.evaluate(config.amount ?? config[1], record)) || 0;
            const unit = this.evaluate(config.unit ?? config[2], record) || 'day';
            return dayjs(baseDate).add(amount, unit).format('YYYY-MM-DD HH:mm:ss');
        },
        '$timeDiff': (config, record) => {
            const startRaw = this.evaluate(config.start, record);
            const endRaw = this.evaluate(config.end, record);
            const unit = this.evaluate(config.unit, record) || 'hour';
            if (!startRaw || !endRaw) return 0;

            const parseDate = (val: any) => {
                if (typeof val === 'string' && val.includes(':') && !val.includes('-')) {
                    const [hh, mm] = val.split(':');
                    return dayjs().hour(parseInt(hh)).minute(parseInt(mm)).second(0).millisecond(0);
                }
                return dayjs(val);
            };

            const start = parseDate(startRaw);
            const end = parseDate(endRaw);
            if (!start.isValid() || !end.isValid()) return 0;

            let diff = end.diff(start, unit, true);
            if (diff < 0 && unit === 'hour') diff += 24;

            return Math.round(diff * 100) / 100;
        },

        // Colecciones y Estadísticas
        '$aggregate': (config, record) => {
            const values = this.evaluate(config.values ?? config[0], record);
            const type = this.evaluate(config.type ?? config[1], record) || 'sum';
            if (!Array.isArray(values) || values.length === 0) return 0;

            let sum = 0, count = 0, min = Infinity, max = -Infinity;

            for (const raw of values) {
                let val = raw;
                if (typeof raw === 'string') {
                    val = raw.replace(/[S/,\s]/g, '').replace(',', '.');
                }
                const num = parseFloat(val);
                if (!isNaN(num)) {
                    sum += num;
                    count++;
                    if (num < min) min = num;
                    if (num > max) max = num;
                }
            }

            if (count === 0) return 0;
            switch (type) {
                case 'sum': return sum;
                case 'avg': return sum / count;
                case 'count': return count;
                case 'min': return min;
                case 'max': return max;
                default: return sum;
            }
        }
    };
}
