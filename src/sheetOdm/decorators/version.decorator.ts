import 'reflect-metadata';
import { SHEETS_VERSION_FIELD } from "@sheetOdm/constants/metadata.constants";

export function Version(): PropertyDecorator {
    return (target: any, propertyKey: string | symbol) => {
        Reflect.defineMetadata(SHEETS_VERSION_FIELD, propertyKey.toString(), target.constructor);
    };
}