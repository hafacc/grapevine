import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import DocPage, { Card, H2, List, link, P } from "../../components/doc-page";
import {
  CONTACT_EMAIL,
  HAFA_URL,
  ISSUES_URL,
  REPO_URL,
} from "../../utils/contact";

export const metadata: Metadata = {
  title: "privacy policy — grapevine",
  description:
    "What grapevine stores, who can see it, and what a recommendation can and cannot give away.",
};

const UPDATED = "september 23, 2026";

export default function PrivacyPage(): ReactElement {
  return (
    <DocPage title="privacy policy" updated={UPDATED} route="/privacy/">
      <P>
        grapevine is a friends-only recommendation app, made and run by{" "}
        <a className={link} href={HAFA_URL}>
          hafa.cc
        </a>
        . It keeps the minimum it needs to work, shows your ratings to nobody,
        and sells nothing to anyone.
      </P>

      <H2>what grapevine promises you</H2>
      {/* The only place in grapevine where "no counts" and "no attribution" are
          written as commitments rather than as descriptions of how it
          currently behaves. */}
      <Card>
        <List>
          <li>
            <strong>No counts.</strong> No screen shows how many people rated a
            thing, an average, a percentage, or “four friends liked this”. A
            score is a bar with no word beside it.
          </li>
          <li>
            <strong>No attribution.</strong> No screen shows who rated a thing,
            who created one, or which friend a recommendation came through.
          </li>
        </List>
        <p className="mt-4">
          These are product commitments, not just current behaviour: if they
          ever change, this page changes first. What a recommendation can still
          imply — and it can imply that someone close to you liked something —
          is written out plainly below.
        </p>
      </Card>

      <H2>signing in</H2>
      <P>
        Google is the only way in. There is no password to set, no code to
        receive, and no other provider. What comes across with the sign-in is
        the name on your Google account and the address of its profile photo;
        the photo itself is loaded from Google's image host, because grapevine
        stores no images of its own.
      </P>

      <H2>what grapevine stores</H2>
      <List>
        <li>
          <strong>Your profile</strong> — a display name and an optional photo
          address. The name starts as the first name on your Google account and
          is yours to change whenever you like, by tapping it on the people
          screen. There is no username, and nobody can find you by typing
          anything.
        </li>
        <li>
          <strong>Your friendships</strong> — who you are connected to.
        </li>
        <li>
          <strong>Your friend link</strong> — if you have made one, the link and
          when you made it, so you can copy it again.
        </li>
        <li>
          <strong>Your ratings</strong> — one row per thumb: which thing, up or
          down, and the time you gave it.
        </li>
        <li>
          Names you reported. Admins see how many reports a name has, never who
          made them.
        </li>
        <li>
          <strong>Your feed</strong> — the recommendations built for you and the
          working numbers behind them, rebuilt in place rather than piled up.
        </li>
        <li>
          <strong>The catalog of things</strong> — a name and when it was added.
          Who added it is recorded in a column no user of the app can read, so
          that abuse can be traced; it is shown nowhere.
        </li>
        <li>
          <strong>Names you reported</strong>, which no user of the app can see.
        </li>
        <li>
          <strong>Diagnostics</strong>, occasionally — see below.
        </li>
      </List>

      <H2>who can see what</H2>
      <List>
        <li>
          <strong>Your ratings are yours.</strong> No friend, and no one whose
          feed your thumbs help shape, can read them. What does read them is the
          recompute — the server job that builds one person's recommendations.
          It reads the ratings of the people within a viewer's reach inside the
          database, for the length of one call, and what it writes back is for
          that one viewer and says nothing about who rated what. No browser ever
          receives another person's ratings, in any form.
        </li>
        <li>
          <strong>Your friend list is visible to you</strong> and, one
          connection at a time, to the friend at the other end of it. Nobody
          else can ask who you are connected to. Either of you can unfriend the
          other, and it ends for both at once.
        </li>
        <li>
          <strong>Your profile</strong> is readable by you and your friends.
          Whoever holds your link also sees your name and photo, even before
          signing in, and is asked whether to be your friend. There is no way to
          list or search for accounts. Unfriending someone takes away the access
          being friends gave them.
        </li>
        <li>
          <strong>A friend link works for whoever has it.</strong> Anyone who
          opens your link can become your friend, with everything a friend can
          learn from their feed, until you make a new one or turn it off. Send
          it only where you mean it to go. Replacing or turning off your link
          stops anyone new using it; it does not unfriend the people it already
          brought in.
        </li>
        <li>
          <strong>Your feed and the numbers behind it</strong> are readable by
          you and by nobody else, and no browser can write them at all — not
          even yours.
        </li>
        <li>
          <strong>Nothing is public to a signed-out visitor</strong> except the
          app's shell and these pages.
        </li>
        <li>
          <strong>
            hafa.cc, which runs the project, can read the database
          </strong>{" "}
          to keep it working or when the law requires it; it does not look
          otherwise.
        </li>
      </List>

      <H2>what a recommendation can give away</H2>
      <P>
        grapevine does not try to make it impossible to work out who liked
        something. That would cost the recommendations more than a friends app
        is asking for. What it does is make it take deliberate, repeated effort
        rather than a glance — and here is exactly what that means.
      </P>
      <List>
        <li>
          <strong>
            A thing needs support behind it before it appears at all
          </strong>
          , which is why a single distant stranger never surfaces anything on
          their own. Whether one direct friend's thumb clears that bar is not a
          promise this design makes: how much a friend's thumb is worth is
          estimated every night from how much people on grapevine actually agree
          with their friends. As things stand it clears it —{" "}
          <strong>
            so with exactly one friend, your feed is that friend's ratings
          </strong>
          . With a few friends it still says that <em>someone</em> close to you
          liked a thing.
        </li>
        <li>
          <strong>The friction between that and knowing who, in full:</strong>{" "}
          no counts anywhere, nothing ordered by how recently it was rated, a
          bar instead of a number, a feed rebuilt on a delay rather than the
          moment somebody rates, and the floor. That is friction, not secrecy,
          and we would rather write it down than imply more.
        </li>
        <li>
          <strong>What any account in your network can learn about you</strong>{" "}
          — including a bot some friend accepted — is the weighted opinion of
          its own reach. Aggregate taste, not individual ratings — with the one
          exception above turned around: an account whose only friend is you
          sees your thumbs as its feed, exactly as you would see theirs.
        </li>
        <li>
          <strong>
            How much grapevine thinks you and a particular person agree
          </strong>{" "}
          is shown to nobody, including you. Those numbers never leave the
          server, and describe only your own feed.
        </li>
      </List>
      <P>
        <Link className={link} href="/how/">
          How it works
        </Link>{" "}
        explains the rest of the mechanism, including how much of your network a
        stranger can ever be.
      </P>

      <H2>the names of things are public</H2>
      <P>
        A thing's name is the one piece of user-written text that anyone signed
        in who searches for it can read, and it can never be changed, because
        nothing in the catalog can be edited by anyone — the name, lower-cased,
        is the thing, so “Café Bleu” and “café bleu” are the same one. So a name
        like “Blue Bottle (rated by 9 friends)”, or a real person's name, is
        possible. Tags work the same way. This version accepts that with two
        limits on the damage: names are drawn as plain text and never as a link
        or as markup, and searching looks past accents and punctuation, so a
        misleading spelling doesn't block anyone else from the thing they meant.
        Report a bad name at the bottom of its screen; a name that is removed is
        removed for everyone.
      </P>

      <H2>live updates</H2>
      <P>
        Some screens keep up without a reload. Only rows added and rows changed
        are ever broadcast, never rows deleted, and that is deliberate: a
        deleted row is gone, so there is nothing left for the database to check
        who is allowed to see it, and sending one out would tell every listening
        browser which two accounts had just stopped being connected. What it
        costs is that an unfriending reaches the other person on their next load
        rather than at once.
      </P>

      <H2>trackers, and what is in your browser</H2>
      <P>
        The site loads no analytics, no ad tech, no tracking pixels and no
        third-party scripts of any kind — even the fonts are part of the
        download rather than fetched from somewhere else as you read. What
        grapevine keeps in your browser is for you rather than about you: your
        session, your light or dark choice, whether you closed the list's hint,
        a copy of the feed you were last shown, and a copy of the app itself so
        it opens without waiting for the network.
      </P>
      <P>
        Two things it does not control. A profile photo is fetched from Google's
        image host, because that is where a Google account's photo lives. And
        GitHub Pages, which serves the app, sees ordinary web-server logs — your
        IP address among them — when you load the page.
      </P>

      <H2>diagnostics</H2>
      <P>
        When something goes wrong in a way that throws no error — a screen that
        silently stalls — grapevine may write a short record of what the app was
        doing at that moment, so the bug can be fixed. No user of the app can
        read one back, including whoever's browser wrote it, and a scheduled
        statement in the database deletes them about a week later.
      </P>

      <H2>leaving</H2>
      <P>
        Delete your account at the bottom of the people screen. Your profile,
        your ratings, your feed, your friendships and your link are removed at
        once. Names you added to the catalog stay: a name is a shared entry
        rather than a post of yours, and nothing can change or remove one. A
        one-way fingerprint of your Google account is kept until midnight UTC,
        so deleting can't reset the daily limit.
      </P>

      <H2>children</H2>
      <P>
        grapevine is for adults and is not directed at children. If you believe
        an account exists for someone under 18, email{" "}
        <a className={link} href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>{" "}
        and it will be removed.
      </P>

      <H2>changes, and asking</H2>
      <P>
        If grapevine's practices change, this page changes with them and the
        date at the top is updated; grapevine is open source, so{" "}
        <a className={link} href={`${REPO_URL}/commits`}>
          every previous version of this page
        </a>{" "}
        is public. Questions about privacy:{" "}
        <a className={link} href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        , or{" "}
        <a className={link} href={ISSUES_URL}>
          an issue on GitHub
        </a>
        .
      </P>
    </DocPage>
  );
}
