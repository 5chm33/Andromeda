---- MODULE Proposal_b7fe2009 ----
EXTENDS Naturals, Booleans

VARIABLES placeholder

Init ==
  /\ TRUE

Next ==
  /\ TRUE

UtilityImproved == TRUE \* Utility delta: 0.0000

Spec == Init /\ [][Next]_<<placeholder>>

Invariant == UtilityImproved

====
