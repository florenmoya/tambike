import { CalendarDays, MapPin, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { MemberMediaImage } from "./member-media-image";
import type { MemberProfileView, MotorcycleShowcase } from "./types";

function initialsFor(displayName: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function motorcycleTitle(motorcycle: MotorcycleShowcase) {
  return motorcycle.nickname || `${motorcycle.make} ${motorcycle.model}`;
}

export interface RiderGarageViewProps {
  profile: MemberProfileView;
  prioritizeMedia?: boolean;
}

export function RiderGarageView({
  profile,
  prioritizeMedia = false,
}: RiderGarageViewProps) {
  const motorcycle = profile.motorcycle;
  const photos = motorcycle?.photos.toSorted(
    (left, right) => left.position - right.position,
  ) ?? [];
  const hero = photos[0];

  return (
    <article className="garage-card" aria-labelledby="garage-card-title">
      <header className="garage-identity-plate">
        <div className="garage-avatar">
          {profile.profilePhotoUrl ? (
            <MemberMediaImage
              src={profile.profilePhotoUrl}
              alt={`${profile.displayName} profile photo`}
              width={512}
              height={512}
              sizes="(max-width: 640px) 112px, 152px"
              priority={prioritizeMedia}
            />
          ) : (
            <span aria-label={`${profile.displayName} profile photo placeholder`}>
              {initialsFor(profile.displayName)}
            </span>
          )}
        </div>

        <div className="garage-identity-copy">
          <div className="garage-identity-kicker">
            <span>{profile.role === "organizer" ? "Organizer garage" : "Rider garage"}</span>
            {profile.organizer ? (
              <Badge variant="secondary">
                <ShieldCheck aria-hidden="true" /> Organizer
              </Badge>
            ) : null}
          </div>
          <h1 id="garage-card-title">{profile.displayName}</h1>
          <div className="garage-profile-facts">
            <span><MapPin aria-hidden="true" /> {profile.area}</span>
            <span><CalendarDays aria-hidden="true" /> Joined {profile.joinedAt}</span>
            {profile.organizer ? (
              <span>{profile.organizer.hostedEventCount} hosted events</span>
            ) : null}
          </div>
          {profile.bio ? <p>{profile.bio}</p> : <p>Garage notes are still being written.</p>}
        </div>
      </header>

      {motorcycle ? (
        <section className="garage-showcase" aria-labelledby="motorcycle-title">
          <div className="garage-showcase-heading">
            <span>One bike, kept close</span>
            <h2 id="motorcycle-title">{motorcycleTitle(motorcycle)}</h2>
          </div>

          {hero ? (
            <div className="garage-motorcycle-hero">
              <MemberMediaImage
                src={hero.url}
                alt={`${profile.displayName}'s ${motorcycle.make} ${motorcycle.model}`}
                width={1600}
                height={1200}
                sizes="(max-width: 720px) 100vw, 1120px"
                priority={prioritizeMedia}
              />
              <span className="garage-photo-index">
                01 / {String(photos.length).padStart(2, "0")}
              </span>
            </div>
          ) : (
            <div className="garage-motorcycle-empty">
              <span>Showcase awaiting its first photograph</span>
              <strong>{motorcycle.make} {motorcycle.model}</strong>
            </div>
          )}

          <dl className="garage-specifications">
            <div><dt>Make</dt><dd>{motorcycle.make}</dd></div>
            <div><dt>Model</dt><dd>{motorcycle.model}</dd></div>
            {motorcycle.year ? <div><dt>Year</dt><dd>{motorcycle.year}</dd></div> : null}
            {motorcycle.displacementCc ? (
              <div><dt>Engine</dt><dd>{motorcycle.displacementCc} cc</dd></div>
            ) : null}
          </dl>

          {motorcycle.description ? (
            <p className="garage-motorcycle-story">{motorcycle.description}</p>
          ) : null}

          {photos.length ? (
            <ol className="garage-contact-strip" aria-label="Motorcycle photo contact strip">
              {photos.map((photo, index) => (
                <li key={photo.url}>
                  <MemberMediaImage
                    src={photo.url}
                    alt={`${motorcycleTitle(motorcycle)} photo ${index + 1} of ${photos.length}`}
                    width={photo.width || 400}
                    height={photo.height || 300}
                    sizes="(max-width: 640px) 32vw, 208px"
                  />
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : (
        <section className="garage-showcase-empty" aria-labelledby="empty-garage-title">
          <span>Motorcycle showcase</span>
          <h2 id="empty-garage-title">No motorcycle added yet</h2>
          <p>This garage card is published, but its keeper has not added a motorcycle.</p>
        </section>
      )}
    </article>
  );
}
