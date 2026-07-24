import type { StaticImageData } from "next/image";
import araiHjcCharityRide from "../../../public/demo/poster-arai-hjc-charity-ride.jpg";
import boysGarageCrossmeet from "../../../public/demo/poster-boys-garage-crossmeet-tambike.jpg";
import boysUnderboneLaguna from "../../../public/demo/poster-boys-underbone-laguna-tambike.jpg";
import calabarzonEndurance from "../../../public/demo/poster-calabarzon-endurance-ride.jpg";
import cafeClassico from "../../../public/demo/poster-tambike-cafe-classico.jpg";
import ccphCebu from "../../../public/demo/poster-ccph-cebu-official-tambike.jpg";
import ccphUpperEast from "../../../public/demo/poster-ccph-upper-east-tambike.jpg";
import ducatiTrackDay from "../../../public/demo/poster-ducati-track-day.jpg";
import fullprintManila from "../../../public/demo/poster-fullprint-manila-tambike.jpg";
import irEnduranceRound3 from "../../../public/demo/poster-ir-endurance-rd3.jpg";
import kapeMoToTagaytay from "../../../public/demo/poster-kape-mo-to-tagaytay-tambike.jpg";
import lagunaMotofest from "../../../public/demo/poster-laguna-motofest-2026.jpg";
import longRideCharity from "../../../public/demo/poster-long-ride-charity.jpg";
import makinaMotoExpoCebu from "../../../public/demo/poster-makina-moto-expo-cebu.jpg";
import mandirigmaEndutour from "../../../public/demo/poster-mandirigma-endutour-v5.jpg";
import mindanaoMotocross from "../../../public/demo/poster-mindanao-wide-motocross-2026-2nd-leg.jpg";
import motoirRound4 from "../../../public/demo/poster-motoir-round-4.jpg";
import motoirRound5 from "../../../public/demo/poster-motoir-round-5.jpg";
import motoirYouthCup from "../../../public/demo/poster-motoir-youth-cup-15-16.jpg";
import ngoStreetDragFinal from "../../../public/demo/poster-ngo-street-drag-final.jpg";
import petronSgpRound3 from "../../../public/demo/poster-petron-sgp-round-3.jpg";
import swabzClassicBike from "../../../public/demo/poster-swabz-classic-bike-tambike.jpg";
import tambikeNightMalabon from "../../../public/demo/poster-tambike-night-malabon.jpg";
import ylocoBandits from "../../../public/demo/poster-yloco-bandits-classic-tambike.jpg";

const EVENT_POSTER_ASSETS: Record<string, StaticImageData> = {
  "/demo/poster-arai-hjc-charity-ride.jpg": araiHjcCharityRide,
  "/demo/poster-boys-garage-crossmeet-tambike.jpg": boysGarageCrossmeet,
  "/demo/poster-boys-underbone-laguna-tambike.jpg": boysUnderboneLaguna,
  "/demo/poster-calabarzon-endurance-ride.jpg": calabarzonEndurance,
  "/demo/poster-tambike-cafe-classico.jpg": cafeClassico,
  "/demo/poster-ccph-cebu-official-tambike.jpg": ccphCebu,
  "/demo/poster-ccph-upper-east-tambike.jpg": ccphUpperEast,
  "/demo/poster-ducati-track-day.jpg": ducatiTrackDay,
  "/demo/poster-fullprint-manila-tambike.jpg": fullprintManila,
  "/demo/poster-ir-endurance-rd3.jpg": irEnduranceRound3,
  "/demo/poster-kape-mo-to-tagaytay-tambike.jpg": kapeMoToTagaytay,
  "/demo/poster-laguna-motofest-2026.jpg": lagunaMotofest,
  "/demo/poster-long-ride-charity.jpg": longRideCharity,
  "/demo/poster-makina-moto-expo-cebu.jpg": makinaMotoExpoCebu,
  "/demo/poster-mandirigma-endutour-v5.jpg": mandirigmaEndutour,
  "/demo/poster-mindanao-wide-motocross-2026-2nd-leg.jpg": mindanaoMotocross,
  "/demo/poster-motoir-round-4.jpg": motoirRound4,
  "/demo/poster-motoir-round-5.jpg": motoirRound5,
  "/demo/poster-motoir-youth-cup-15-16.jpg": motoirYouthCup,
  "/demo/poster-ngo-street-drag-final.jpg": ngoStreetDragFinal,
  "/demo/poster-petron-sgp-round-3.jpg": petronSgpRound3,
  "/demo/poster-swabz-classic-bike-tambike.jpg": swabzClassicBike,
  "/demo/poster-tambike-night-malabon.jpg": tambikeNightMalabon,
  "/demo/poster-yloco-bandits-classic-tambike.jpg": ylocoBandits,
};

export function resolveEventPoster(
  posterPath: string,
): string | StaticImageData {
  return EVENT_POSTER_ASSETS[posterPath] ?? posterPath;
}
