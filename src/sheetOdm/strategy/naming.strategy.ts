export class NamingStrategy {
    /**
     * Formatea el nombre de la pestaña basándose en la clase (predictivo).
     * Ejemplo: ObreroEntity -> OBREROS
     */
    static formatSheetName(className: string): string {
        let baseName = className.replace(/(Entity|Model|Schema)$/i, '');
        // Eliminar guiones bajos si los hay antes de analizar
        baseName = baseName.replace(/_/g, '');
        const lastChar = baseName.slice(-1).toLowerCase();

        let finalName: string;
        if (['a', 'e', 'i', 'o', 'u'].includes(lastChar)) {
            finalName = `${baseName}S`;
        } else if (lastChar === 'z') {
            finalName = `${baseName.slice(0, -1)}CES`;
        } else {
            finalName = `${baseName}ES`;
        }

        return finalName.toUpperCase();
    }

    /**
     * Formatea el nombre físico de una columna a mayúsculas estrictas.
     * Ejemplo: nombreCompleto -> NOMBRECOMPLETO, obrero_id -> OBREROID
     */
    static formatColumnName(propName: string): string {
        return propName.replace(/_/g, '').toUpperCase();
    }
}
