import { createSettingsService } from "@/server/settings/settings-service";

export async function GET() {
  return Response.json(await createSettingsService().getPublicSettings());
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();

    return Response.json(
      await createSettingsService().updatePublicSettings(body),
    );
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Invalid settings payload.",
      { status: 400 },
    );
  }
}
