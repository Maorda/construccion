// En @sheetOdm/decorators/virtual-property.decorator.ts
import { SHEETS_VIRTUAL_COLUMNS } from '@sheetOdm/constants/metadata.constants';

export interface VirtualOptions {
    /** El grupo al que pertenecerá este cálculo en el JSON final */
    group: string; // Ya no es opcional
}

export function VirtualProperty(options: VirtualOptions): MethodDecorator {
    return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
        const classConstructor = target.constructor;

        // Ahora es obligatorio pasar options, por lo que no necesitamos validar existencia
        const config = {
            propertyKey: propertyKey.toString(),
            group: options.group
        };

        const virtuals = Reflect.getMetadata(SHEETS_VIRTUAL_COLUMNS, classConstructor) || [];
        virtuals.push(config);
        Reflect.defineMetadata(SHEETS_VIRTUAL_COLUMNS, virtuals, classConstructor);
    };
}