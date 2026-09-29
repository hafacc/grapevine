import type { Metadata } from "next";
import type { ReactElement } from "react";
import DocPage, { H2, List, link, P } from "../../components/doc-page";
import {
  CONTACT_EMAIL,
  HAFA_URL,
  ISSUES_URL,
  REPO_URL,
} from "../../utils/contact";

export const metadata: Metadata = {
  title: "privacy policy — grapevine",
  description:
    "What grapevine stores, who can see it, and what your list can give away.",
};

const UPDATED = "september 26, 2026";

const GOOGLE_PRIVACY_URL = "https://policies.google.com/privacy";

// Everyone who handles a visitor's data on grapevine's behalf, each linked to
// its own policy.
const SERVICES = [
  {
    name: "Google",
    url: GOOGLE_PRIVACY_URL,
    use: "sign-in, and your profile photo",
  },
  {
    name: "Supabase",
    url: "https://supabase.com/privacy",
    use: "the database, sign-in sessions and the server functions",
  },
  {
    name: "GitHub Pages",
    url: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
    use: "serves the site, and logs IP addresses",
  },
  {
    name: "Cloudflare",
    url: "https://www.cloudflare.com/privacypolicy/",
    use: "the domain name, and forwarding mail sent to support",
  },
  {
    name: "Wikipedia (Wikimedia Foundation)",
    url: "https://foundation.wikimedia.org/wiki/Policy:Privacy_policy",
    use: "matches when you add a thing",
  },
  {
    name: "Photon (komoot)",
    url: "https://www.komoot.com/privacy",
    use: "matches for places when you add a thing",
  },
  {
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    use: "the names of places Photon finds, © OpenStreetMap contributors",
  },
] as const;

export default function PrivacyPage(): ReactElement {
  const email = (
    <a className={link} href={`mailto:${CONTACT_EMAIL}`}>
      {CONTACT_EMAIL}
    </a>
  );
  return (
    <DocPage title="privacy policy" updated={UPDATED} route="/privacy/">
      <P>
        grapevine is made and run by{" "}
        <a className={link} href={HAFA_URL}>
          hafa.cc
        </a>
        . It stores what it needs to work and doesn't sell your data.
      </P>

      <H2>signing in</H2>
      <P>
        grapevine uses Google to sign in, so it stores no password. Google sends
        your name, email address and the address of your profile photo, and
        grapevine keeps them. No other user can see your email address. Google
        has{" "}
        <a className={link} href={GOOGLE_PRIVACY_URL}>
          its own privacy policy
        </a>
        .
      </P>

      <H2>what grapevine stores</H2>
      <List>
        <li>
          Your display name (your first name, or "unknown" if Google sends none,
          until you change it) and photo address.
        </li>
        <li>Your link and your vine.</li>
        <li>Your ratings: which thing, up or down, and when.</li>
        <li>
          Ratings you cleared: which thing and when, for about eight days, to
          update lists.
        </li>
        <li>Your list, and the numbers used to build it.</li>
        <li>
          The names of things, and who added each. No user can see who added
          one.
        </li>
        <li>
          A thing's Wikipedia or OpenStreetMap id, when it has one, and who
          added it. No user can see who.
        </li>
        <li>
          Names you reported. Admins see how many reports a name has, never who
          made them.
        </li>
        <li>
          Occasional error reports, deleted after about a week, which no user
          can read.
        </li>
      </List>
      <P>
        hafa.cc can read the database to keep it working or when the law
        requires it.
      </P>

      <H2>services grapevine uses</H2>
      <List>
        {SERVICES.map(({ name, url, use }) => (
          <li key={name}>
            <a className={link} href={url}>
              {name}
            </a>
            : {use}
          </li>
        ))}
      </List>

      <H2>who can see what</H2>
      <List>
        <li>
          <strong>Your ratings:</strong> only you. The server reads them to
          build lists for people near you in the network, and keeps a private
          copy to refresh those lists, deleted after a week unused. Those lists
          never say who rated what.
        </li>
        <li>
          <strong>Your vine:</strong> you, and each person in it sees that you
          are in theirs. Either of you can remove the other.
        </li>
        <li>
          <strong>Your name and photo:</strong> your vine, and anyone holding
          your link, even signed out.
        </li>
        <li>
          <strong>Your list:</strong> only you.
        </li>
      </List>

      <H2>your link</H2>
      <P>
        Anyone with your link can join your vine. You can turn it off or replace
        it at any time; people it already added stay.
      </P>

      <H2>what your list can give away</H2>
      <P>
        No screen shows counts, averages, or who rated what. Even so,{" "}
        <strong>
          with exactly one person in your vine, your list is their ratings
        </strong>
        , and theirs is yours. With a few, it still hints that someone close to
        you liked a thing. No counts and a delay make it harder, not impossible,
        to tell who.
      </P>

      <H2>names of things</H2>
      <P>
        Anyone signed in can find a thing by its name, and a name can never be
        changed, so don't put anything personal in one. Report a bad name at the
        bottom of its screen; a name that is removed is removed for everyone.
      </P>

      <H2>adding a thing</H2>
      <P>
        When you add a thing, your browser asks Wikipedia, Wikidata and Photon
        (komoot's search of OpenStreetMap) for matches, directly. They see what
        you typed and your IP address, not your account. Photon also gets your
        approximate location, to about a kilometre, only when you add something.
        Both can be turned off on the people screen. A thing you match keeps
        that site's id, so anyone can follow its link.
      </P>

      <H2>your browser</H2>
      <P>
        No analytics, ads or trackers. Your browser keeps your session, your
        theme, whether you closed the list's hint, whether lookups and location
        are on, a copy of your last list, and the app itself so it opens
        offline. The tab keeps a link you opened until you answer it, and the
        screen you were on while you sign in. Your photo loads from Google.
      </P>

      <H2>leaving</H2>
      <P>
        Delete your account at the bottom of the people screen. Your profile,
        ratings, list, vine, link and reports are removed at once. Names of
        things you added stay. A one-way fingerprint of your Google account is
        kept until midnight UTC, so deleting can't reset the daily limit. An
        account with an empty vine is locked, not deleted.
      </P>

      <H2>children</H2>
      <P>
        grapevine is for adults. If an account belongs to someone under 18,
        email {email} and it will be removed.
      </P>

      <H2>changes</H2>
      <P>
        This page changes when grapevine's practices do, and the date at the top
        moves.{" "}
        <a className={link} href={`${REPO_URL}/commits`}>
          Every earlier version
        </a>{" "}
        is public. Questions: {email} or{" "}
        <a className={link} href={ISSUES_URL}>
          GitHub
        </a>
        .
      </P>
    </DocPage>
  );
}
