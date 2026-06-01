import { SHEETS_VIRTUALS } from '@sheetOdm/constants/metadata.constants';

export interface VirtualOptions {
    /** * El grupo al que pertenecerá este cálculo en el JSON final.
     * Útil para organizar virtuals en categorías (ej: 'calculos', 'totales')
     */
    group: string;
}
export function VirtualProperty(options: VirtualOptions): MethodDecorator {
    return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
        const classConstructor = target.constructor;
        const config = {
            propertyKey: propertyKey.toString(),
            group: options.group
        };

        // Cambio a SHEETS_VIRTUALS
        const virtuals = Reflect.getMetadata(SHEETS_VIRTUALS, classConstructor) || [];
        virtuals.push(config);
        Reflect.defineMetadata(SHEETS_VIRTUALS, virtuals, classConstructor);
    };
}