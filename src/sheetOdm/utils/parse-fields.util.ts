// src/common/utils/parse-fields.util.ts

/**
 * Convierte un query string "id,calculos.salario,otro" 
 * en un objeto de proyección { id: 1, calculos: { salario: 1 }, otro: 1 }
 */
export function parseFields(fieldsQuery?: string): Record<string, any> {
    if (!fieldsQuery) return {};

    const projection: any = {};
    const fields = fieldsQuery.split(',');

    for (const field of fields) {
        if (field.includes('.')) {
            const [group, prop] = field.split('.');
            if (!projection[group]) projection[group] = {};
            projection[group][prop] = 1;
        } else {
            projection[field] = 1;
        }
    }
    return projection;
}