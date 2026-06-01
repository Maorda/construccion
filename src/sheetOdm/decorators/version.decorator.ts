// @sheetOdm/decorators/version.decorator.ts
import { SHEETS_VERSION_FIELD } from '@sheetOdm/constants/metadata.constants';

export function Version() {
    return (target: any, propertyKey: string) => {
        Reflect.defineMetadata(SHEETS_VERSION_FIELD, propertyKey, target.constructor);
    };
}