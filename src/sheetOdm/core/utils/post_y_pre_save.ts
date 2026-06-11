import { SHEETS_HOOKS } from "@sheetOdm/constants/metadata.constants.js";


export function PreSave(): MethodDecorator {
    return (target: Object, propertyKey: string | symbol) => {
        const hooks = Reflect.getMetadata(SHEETS_HOOKS, target.constructor) || { preSave: [], postSave: [] };
        hooks.preSave.push(propertyKey);
        Reflect.defineMetadata(SHEETS_HOOKS, hooks, target.constructor);
    };
}

export function PostSave(): MethodDecorator {
    return (target: Object, propertyKey: string | symbol) => {
        const hooks = Reflect.getMetadata(SHEETS_HOOKS, target.constructor) || { preSave: [], postSave: [] };
        hooks.postSave.push(propertyKey);
        Reflect.defineMetadata(SHEETS_HOOKS, hooks, target.constructor);
    };
}