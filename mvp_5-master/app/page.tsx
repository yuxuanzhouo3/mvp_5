import AIGeneratorPlatform from "../components/AIGeneratorPlatform";
import { getAppDisplayName } from "@/lib/app-branding";

export default async function Home() {
  const appDisplayName = await getAppDisplayName();
  return <AIGeneratorPlatform appDisplayName={appDisplayName} />;
}
