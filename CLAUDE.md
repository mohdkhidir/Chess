# Chess Position Extraction

## Board Snapshot

Extracted from screenshot. White is at the bottom (rank 1), Black at the top (rank 8).
Highlighted squares: **e1** (green/yellow = piece moved from here), **f1** (red = king moved here, possibly in check).

---

## Piece Positions

### Black Pieces
| Piece  | Square |
|--------|--------|
| King   | e8     |
| Queen  | d8     |
| Rook   | h8     |
| Knight | d7     |
| Bishop | e7     |
| Knight | f6     |
| Pawn   | a7     |
| Pawn   | b7     |
| Pawn   | c7     |
| Pawn   | d6     |
| Pawn   | e5     |
| Pawn   | g7     |
| Pawn   | h7     |

### White Pieces
| Piece  | Square | Note                        |
|--------|--------|-----------------------------|
| King   | f1     | Red highlight (last move to here / check) |
| Rook   | a1     |                             |
| Rook   | e1     | Green/yellow highlight (last move from here) |
| Queen  | d2     |                             |
| Bishop | g5     |                             |
| Knight | b3     |                             |
| Knight | f3     |                             |
| Pawn   | b2     |                             |
| Pawn   | c3     |                             |
| Pawn   | e4     |                             |
| Pawn   | g2     |                             |
| Pawn   | h2     |                             |

---

## Board Diagram

```
  a    b    c    d    e    f    g    h
8 .    .    .    q    k    .    .    r
7 p    p    p    n    b    .    p    p
6 .    .    .    p    .    n    .    .
5 .    .    .    .    p    .    B    .
4 .    .    .    .    P    .    .    .
3 .    N    P    .    .    N    .    .
2 .    P    .    Q    .    .    P    P
1 R    .    .    .    R    K    .    .
```

*(Uppercase = White, Lowercase = Black)*

---

## FEN Notation

```
3qk2r/pppnb1pp/3p1n2/4p1B1/4P3/1NP2N2/1P1Q2PP/R3RK2 w - - 0 1
```

> **Side to move:** White (assumed)  
> **Castling rights:** None for White (King has moved from e1 to f1); Black may retain kingside castling (King on e8, Rook on h8).  
> **En passant:** None observed.

---

## Notes

- The **White King moved from e1 → f1** (indicated by the highlighted squares).
- The **red highlight on f1** may indicate the White King is currently in check.
- White has both rooks still on the board (a1 and e1).
- Black's queenside has not castled; the queenside rook is not visible (likely already off the board or never moved to a8).
