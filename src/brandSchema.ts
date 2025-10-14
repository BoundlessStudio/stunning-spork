export const brandJsonSchema = {
  name: "BrandExtraction",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      logo: { type: "string", default: "" },
      logos: { type: "array", items: { type: "string" }, default: [] },
      icons: { type: "array", items: { type: "string" }, default: [] },
      palette: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            hex: { type: "string" },
            role: { type: "string" },
            source: { type: "string" }
          },
          required: ["hex"]
        },
        default: []
      },
      accentColor: { type: "string", default: "" },
      backgroundColor: { type: "string", default: "" },
      primaryColor: { type: "string", default: "" },
      secondaryColor: { type: "string", default: "" },
      textColor: { type: "string", default: "" }
    },
    required: [
      "logo",
      "logos",
      "icons",
      "palette",
      "accentColor",
      "backgroundColor",
      "primaryColor",
      "secondaryColor",
      "textColor"
    ]
  }
} as const;

export type BrandExtractionSchema = typeof brandJsonSchema;
