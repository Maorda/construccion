export class ValidationHandleUtil {
    static ValidationHandlers = {
        /**
         * Valida que el campo tenga contenido.
         * Devuelve true si es válido, string con el mensaje si es inválido.
         */
        required: (val: any): true | string => {
            const isValid = val !== undefined && val !== null && String(val).trim() !== '';
            return isValid ? true : 'El campo es obligatorio.';
        },

        /**
         * Valida valor numérico mínimo.
         */
        min: (val: any, min: number): true | string => {
            const num = Number(val);
            return (!isNaN(num) && num >= min) ? true : `Debe ser mayor o igual a ${min}.`;
        },

        /**
         * Valida valor numérico máximo.
         */
        max: (val: any, max: number): true | string => {
            const num = Number(val);
            return (!isNaN(num) && num <= max) ? true : `Debe ser menor o igual a ${max}.`;
        }
    };
}