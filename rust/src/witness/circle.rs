//! Who the viewer's population statistics are read over: the **circle**, the viewer and the people
//! the viewer trusts directly.
//!
//! Base rates, the attributes a thing carries, `κ_a` and the fact reliability each feed every
//! reliability and every region's evidence. Read over everyone reached, a set of accounts behind
//! one person moved all of them, and through them other regions' evidence and the heads' own
//! reliabilities — even counted as one voice among the regions, two hundred bots moved a thing by
//! 4.86 of log-odds behind one connection, past the bound of `2L + ln 2`. Nobody in the circle can
//! be such an account (every one sits behind somebody the viewer trusts directly), and each person
//! in it heads exactly one region, so the circle counts each region as one voice: its head's
//! (DESIGN §2.2, §2.5).

use crate::graph::hop_distances;
use crate::ids::{ItemId, Ratable, UserId};
use crate::snapshot::Snapshot;

/// Who is connected to the viewer, and who is in the circle.
#[derive(Clone, Debug)]
pub struct Circle {
    /// By user index: hops from the viewer, `u32::MAX` for anyone unconnected.
    pub hops: Vec<u32>,
    /// By user index: loaded and connected to the viewer, the people chains may reach.
    pub counted: Vec<bool>,
    /// By user index: the viewer, or someone the viewer trusts directly who was loaded.
    pub member: Vec<bool>,
}

impl Circle {
    pub fn of(snapshot: &Snapshot, viewer: UserId) -> Self {
        let hops: Vec<u32> = hop_distances(snapshot, viewer)
            .into_iter()
            .map(|distance| distance.unwrap_or(u32::MAX))
            .collect();
        let counted: Vec<bool> = snapshot
            .users()
            .map(|user| snapshot.is_loaded(user) && hops[user.index()] != u32::MAX)
            .collect();
        let member: Vec<bool> = snapshot
            .users()
            .map(|user| counted[user.index()] && hops[user.index()] <= 1)
            .collect();
        Circle {
            hops,
            counted,
            member,
        }
    }

    pub fn is_counted(&self, user: UserId) -> bool {
        self.counted[user.index()]
    }

    pub fn is_member(&self, user: UserId) -> bool {
        self.member[user.index()]
    }

    /// The circle, in user order.
    pub fn members(&self) -> impl Iterator<Item = UserId> + '_ {
        self.member
            .iter()
            .enumerate()
            .filter(|&(_, &inside)| inside)
            .map(|(index, _)| UserId(index as u32))
    }
}

/// Up and total thumbs per item over the circle.
#[derive(Clone, Debug)]
pub struct BaseRates {
    items: Vec<(u32, u32)>,
    member: Vec<bool>,
}

impl BaseRates {
    pub fn over(snapshot: &Snapshot, circle: &Circle) -> Self {
        let mut items = vec![(0u32, 0u32); snapshot.item_count()];
        for user in circle.members() {
            for &(ratable, value) in snapshot.ratings(user) {
                let Ratable::Item(item) = ratable else {
                    break;
                };
                let entry = &mut items[item.index()];
                entry.1 += 1;
                if value > 0 {
                    entry.0 += 1;
                }
            }
        }
        BaseRates {
            items,
            member: circle.member.clone(),
        }
    }

    pub fn is_member(&self, user: UserId) -> bool {
        self.member.get(user.index()).copied().unwrap_or(false)
    }

    /// The chance of an up on `item`: a Beta(1,1) posterior over the circle's thumbs, leaving out
    /// the thumbs `people` gave it, so nobody's thumb is judged against itself.
    pub fn up(&self, item: ItemId, people: &[(UserId, i8)]) -> f64 {
        self.up_with(item, (0, 0), people)
    }

    /// The same with `extra` ups and thumbs from outside the circle counted in, which the caller
    /// has already left its own people out of.
    pub fn up_with(&self, item: ItemId, extra: (u32, u32), people: &[(UserId, i8)]) -> f64 {
        let (mut up, mut total) = self.items.get(item.index()).copied().unwrap_or((0, 0));
        up += extra.0;
        total += extra.1;
        for &(person, value) in people {
            if self.member.get(person.index()).copied().unwrap_or(false) {
                total = total.saturating_sub(1);
                if value > 0 {
                    up = up.saturating_sub(1);
                }
            }
        }
        (f64::from(up) + 1.0) / (f64::from(total) + 2.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_circle_is_the_viewer_and_whom_they_trust_directly() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friend = builder.user("friend");
        let further = builder.user("further");
        let stranger = builder.user("stranger");
        builder.edge(viewer, friend).edge(friend, further);
        let snapshot = builder.build();
        let circle = Circle::of(&snapshot, viewer);
        let members: Vec<UserId> = circle.members().collect();
        assert_eq!(members, vec![viewer, friend]);
        assert!(circle.is_counted(further) && !circle.is_member(further));
        assert!(!circle.is_counted(stranger));
    }

    /// However many accounts sit behind a friend, and whatever they rate, the base rate is the
    /// circle's; a reading leaves out only its own people's thumbs, and only those in the circle.
    #[test]
    fn accounts_behind_a_friend_do_not_count_toward_a_base_rate() {
        for bots in [0, 1, 300] {
            let mut builder = Snapshot::builder();
            let viewer = builder.user("viewer");
            let honest = builder.user("honest");
            let friend = builder.user("friend");
            let item = builder.item("thing");
            builder
                .edge(viewer, honest)
                .edge(viewer, friend)
                .rate(honest, Ratable::Item(item), -1)
                .rate(friend, Ratable::Item(item), 1);
            let accounts: Vec<UserId> = (0..bots)
                .map(|index| builder.user(&format!("b{index}")))
                .collect();
            for &bot in &accounts {
                builder.edge(friend, bot).rate(bot, Ratable::Item(item), 1);
            }
            let snapshot = builder.build();
            let circle = Circle::of(&snapshot, viewer);
            let rates = BaseRates::over(&snapshot, &circle);
            assert!((rates.up(item, &[]) - 0.5).abs() < 1e-12, "{bots}");
            assert!((rates.up(item, &[(friend, 1)]) - 1.0 / 3.0).abs() < 1e-12);
            assert!((rates.up(item, &[(honest, -1), (friend, 1)]) - 0.5).abs() < 1e-12);
            for &bot in &accounts {
                assert!((rates.up(item, &[(bot, 1)]) - 0.5).abs() < 1e-12);
            }
            let with_region = rates.up_with(item, (3, 4), &[(friend, 1)]);
            assert!((with_region - 4.0 / 7.0).abs() < 1e-12);
        }
    }
}
