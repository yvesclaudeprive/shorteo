declare const __APP_VERSION__: string;

/** Version de Shorteo (celle de l'installateur), ex. « 0.3.12 ». */
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
