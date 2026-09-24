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
          <strong>Your profile</strong> — a display name, an optional photo
          address, a username if you claim one, and whether you can be found by
          it. A username is claimed once and for good: nothing in grapevine can
          change one or give it back.
        </li>
        <li>
          <strong>Your friendships and pending requests</strong> — who you are
          connected to, and who has asked whom.
        </li>
        <li>
          <strong>Your ratings</strong> — one row per thumb: which thing, up or
          down, and the time you gave it.
        </li>
        <li>
          <strong>Your feed</strong> — the recommendations built for you and the
          working numbers behind them, rebuilt in place rather than piled up.
        </li>
        <li>
          <strong>Your settings</strong> — whether you are findable by username,
          which is on once you pick one and yours to switch off, whether you
          take part in friend suggestions, and the suggestions you have waved
          away.
        </li>
        <li>
          <strong>The catalog of things</strong> — a name and when it was added.
          Who added it is recorded in a column no user of the app can read, so
          that abuse can be traced; it is shown nowhere.
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
          recompute — the server job that builds one person's recommendations,
          and the one behind friend suggestions: both read the ratings of the
          people within a viewer's reach inside the database, for the length of
          one call, and what they write back is for that one viewer and says
          nothing about who rated what. No browser ever receives another
          person's ratings, in any form.
        </li>
        <li>
          <strong>Your friend list is visible to you</strong> and, one
          connection at a time, to the friend at the other end of it. Nobody
          else can ask who you are connected to. Either of you can unfriend the
          other, and it ends for both at once.
        </li>
        <li>
          <strong>Your profile</strong> is readable by you, your friends, anyone
          you have a pending request with, and anyone you are currently
          suggested to, while you stay findable and in suggestions. If you are
          findable by username, someone who types your handle exactly also gets
          it — one account for one exact handle. There is no way to list
          accounts. Unfriending someone takes away the access being friends gave
          them.
        </li>
        <li>
          <strong>
            Your feed, your suggestions and the numbers behind them
          </strong>{" "}
          are readable by you and by nobody else, and no browser can write them
          at all — not even yours.
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

      <H2>friend suggestions by taste</H2>
      <P>
        grapevine can suggest people whose taste matches yours but who you are
        not connected to. It is the one thing here that names you to someone you
        have no connection with, so it starts off and is a line you swipe on,
        under your own row on the people screen — and it is reciprocal: on, you
        are offered to others and they to you; off, neither happens and your own
        list is emptied too.
      </P>
      <List>
        <li>
          A suggestion carries a name, a username and at most three attributes
          the two of you agree about where the rest of your network doesn't —{" "}
          <code>coffee</code>, <code>cycling</code>. Never a number, never how
          much you have in common, and never which things those ratings were on.
          Having nothing to show there is ordinary, and the person is offered
          without it.
        </li>
        <li>
          It takes at least twenty things' worth of informative overlap, the
          list holds at most five people, and you are offered to others only
          while you are also findable by username. Switching either off takes
          you out of everyone's suggestions at once, and switching off being
          findable switches off suggestions with it.
        </li>
        <li>
          Waving one away is permanent. Accepting one is an ordinary friend
          request, and nothing about a suggestion changes any of your scores
          until you do.
        </li>
      </List>

      <H2>the names of things are public, and permanent</H2>
      <P>
        A thing's name is the one piece of user-written text that anyone signed
        in who searches for it can read, and it can never be changed, because
        nothing in the catalog can be edited or removed by anyone — the name,
        lower-cased, is the thing, so “Café Bleu” and “café bleu” are the same
        one. So a name like “Blue Bottle (rated by 9 friends)”, or a real
        person's name, is possible and permanent. Tags work the same way. This
        version accepts that with two limits on the damage: names are drawn as
        plain text and never as a link or as markup, and searching looks past
        accents and punctuation, so a misleading spelling doesn't block anyone
        else from the thing they meant. A way to report and hide one is planned
        and not built; until it exists,{" "}
        <a className={link} href={`mailto:${CONTACT_EMAIL}`}>
          write to us
        </a>
        .
      </P>

      <H2>live updates</H2>
      <P>
        Some screens keep up without a reload. Only rows added and rows changed
        are ever broadcast, never rows deleted, and that is deliberate: a
        deleted row is gone, so there is nothing left for the database to check
        who is allowed to see it, and sending one out would tell every listening
        browser which two accounts had just stopped being connected. What it
        costs is that a declined or withdrawn request reaches the other person
        on their next load rather than at once.
      </P>

      <H2>trackers, and what is in your browser</H2>
      <P>
        The site loads no analytics, no ad tech, no tracking pixels and no
        third-party scripts of any kind — even the fonts are part of the
        download rather than fetched from somewhere else as you read. What
        grapevine keeps in your browser is for you rather than about you: your
        session, your light or dark choice, a copy of the feed you were last
        shown, and a copy of the app itself so it opens without waiting for the
        network.
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
        There is no delete-my-account button yet. Until there is,{" "}
        <a className={link} href={`mailto:${CONTACT_EMAIL}`}>
          write to us
        </a>{" "}
        and your profile, your ratings, your feed and your friendships will be
        removed by hand. Names you added to the catalog stay: a name is a shared
        entry rather than a post of yours, and nothing can change or remove one.
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
