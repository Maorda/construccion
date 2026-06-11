import 'reflect-metadata';
import { VirtualOptions } from './interfacesDecorators.js';
import { SHEETS_VIRTUALS } from '@sheetOdm/constants/metadata.constants.js';
export function VirtualProperty(options: VirtualOptions): MethodDecorator {
    return (target: Object, propertyKey: string | symbol) => {
        const classConstructor = target.constructor;
        const config = { propertyKey: propertyKey.toString(), group: options.group };

        const virtuals = Reflect.getMetadata(SHEETS_VIRTUALS, classConstructor) || [];
        virtuals.push(config);
        Reflect.defineMetadata(SHEETS_VIRTUALS, virtuals, classConstructor);
    };
}