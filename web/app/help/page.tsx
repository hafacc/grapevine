import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import DocPage, { H2, List, link, P } from "../../components/doc-page";
import { CONTACT_EMAIL, ISSUES_URL } from "../../utils/contact";

export const metadata: Metadata = {
  title: "help — grapevine",
  description: "The one list, what is on it, and where to reach a person.",
};

export default function HelpPage(): ReactElement {
  return (
    <DocPage title="help" route="/help/">
      <P>
        grapevine gives you a personal ranking of things, built from your own
        thumbs and those of your friends and their friends. There is one screen:
        a list, a search field at the bottom, and the people behind your avatar.
      </P>

      <H2>the list</H2>
      <P>
        With the field empty it is your ranking. Type, and it filters — by a
        thing's name and by its attributes at once, loosely enough that a
        misspelling still finds the thing that is already there. Above the field
        sits <em>add “what you typed”</em>, the whole time there is a query:
        naming a thing that already exists finds it rather than making a second
        one, since “Café Bleu” and “café bleu” are one thing and searching looks
        past accents and punctuation, so “cafe bleu” finds it too. A name once
        given is permanent. Nothing is written until you rate the thing or give
        it an attribute.
      </P>
      <P>
        <strong>You rate by swiping a row: right is yes, left is no.</strong>{" "}
        Swiping the way you already voted takes that rating back; swiping the
        other way flips it. A rated row keeps its bar and tints its background.
        On a wide screen a button at each end of the row does the same thing.
        The eye beside the field hides the things you have already rated.
      </P>
      <P>
        The list is rebuilt when you open the app, if it has not been rebuilt in
        the last ten minutes or you have rated since — your own thumb shows up
        on the next rebuild, and a friend's reaches you on the one after they
        gave it.
      </P>

      <H2>a thing</H2>
      <P>
        Opening a row replaces the list with that thing's own screen. Its title
        bar carries the name and the thing's own bar, and swiping the title bar
        is how you rate the thing itself. Under it every attribute is a row with
        a bar of its own, rated by the same swipe, with the ones your network
        has least to say about first. The field at the bottom filters them and
        offers to add one; the eye hides the attributes you have already
        answered.
      </P>

      <H2>people</H2>
      <P>
        Behind your avatar: your own row, then anyone who has asked to connect,
        then your friends, then people with similar taste. Find someone by
        typing their handle exactly — there is no browsing for people — and ask;
        connections are mutual and have to be accepted. Your friend list is
        visible to you, and each connection on it to the friend at the other
        end. Friends are what the recommendations are made of: with none, there
        is nothing to recommend.
      </P>
      <P>
        Picking a handle makes you findable by it, and the line under your own
        row switches that off and on again. Off, typing your handle finds
        nobody, and you are taken out of friend suggestions too, since nobody
        could send the request a suggestion offers.
      </P>
      <P>
        To unfriend someone, swipe their row and confirm. It ends for both of
        you at once: you drop out of each other's friends and feeds, and being
        friends again takes a new request from one of you.
      </P>
      <P>
        grapevine can also offer you people whose taste matches yours but who
        you don't know. That is off until you swipe the line about friend
        suggestions on, and it is the same switch both ways: off, nobody is
        offered you and you are offered nobody. Switching it on makes you
        findable by your handle again, if you had switched that off.
      </P>

      <H2>tags</H2>
      <P>
        A tag is any lowercase word attached to a thing by rating it —{" "}
        <code>restaurant</code>, <code>cheap</code>, <code>loud</code>,{" "}
        <code>date-night</code>. There is one kind: a category and an attribute
        are the same sort of thing here, which is what lets a tag be as
        arbitrary as it needs to be.
      </P>
      <P>
        A tag answers “does this thing have this tag?”, which is a question of
        fact rather than taste — so a tag is weighted by how much of your
        network has said so, not by whose taste matches yours. Typing one into
        the field keeps a thing when you said yes to that tag yourself, when
        your network isn't clearly against it, or when nothing is known at all:
        unknown is not the same as no.
      </P>

      <H2>what you see</H2>
      <P>
        Nothing in grapevine is a number, a count or a percentage. A thing's
        standing with you is a bar of four segments, filled from the middle, and
        there is no word beside it anywhere. The fill steps in units no finer
        than the error behind that rebuild, so it can never draw a difference
        the arithmetic can't support.
      </P>
      <P>
        A thing with too little behind it isn't shown at all, so “nothing here
        yet” means nothing known, not “everyone disliked it”.
      </P>

      <H2>a recommendation was wrong. how do i fix it?</H2>
      <P>
        <strong>Thumb it down.</strong> That is the whole correction.
      </P>
      <P>
        It does more than hide the one thing. Whose taste counts for you is
        decided by how often you and they turn out to agree, and a thumb is the
        evidence — most of all on the things your network is split over, where
        agreeing says the most. Doing nothing teaches it nothing, so a thumb
        down on something bad is worth as much as a thumb up on something good.
      </P>
      <P>
        Why it happened at all, and what it can and can't fix:{" "}
        <Link className={link} href="/how/">
          How it works
        </Link>
        .
      </P>

      <H2>reaching a person</H2>
      <List>
        <li>
          <strong>Bugs and questions:</strong>{" "}
          <a className={link} href={ISSUES_URL}>
            open an issue on GitHub
          </a>{" "}
          — public, and the fastest way to get something fixed.
        </li>
        <li>
          <strong>Private matters</strong> — a privacy request, a thing named
          something it shouldn't be, anything you'd rather not post publicly:
          email{" "}
          <a className={link} href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </li>
      </List>

      <H2>the fine print</H2>
      <P>
        What grapevine is:{" "}
        <Link className={link} href="/about/">
          About
        </Link>
        . What it stores and why:{" "}
        <Link className={link} href="/privacy/">
          Privacy Policy
        </Link>
        .
      </P>
    </DocPage>
  );
}
