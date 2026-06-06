#!/usr/bin/env python3
"""Command-line two-player chess game."""

import copy
import sys


class Piece:
    def __init__(self, color: str, symbol: str):
        self.color = color   # 'white' or 'black'
        self.symbol = symbol  # 'K', 'Q', 'R', 'B', 'N', 'P'

    def __str__(self):
        return self.symbol.upper() if self.color == 'white' else self.symbol.lower()

    def __repr__(self):
        return f"Piece({self.color!r}, {self.symbol!r})"


class Board:
    def __init__(self):
        self.grid = [[None] * 8 for _ in range(8)]
        self.turn = 'white'
        self.en_passant_target = None  # (row, col) or None
        self.castling_rights = {
            'white': {'kingside': True, 'queenside': True},
            'black': {'kingside': True, 'queenside': True},
        }
        self._setup_initial_position()

    def _setup_initial_position(self):
        back_rank = 'RNBQKBNR'
        for col, sym in enumerate(back_rank):
            self.grid[0][col] = Piece('white', sym)
            self.grid[7][col] = Piece('black', sym)
        for col in range(8):
            self.grid[1][col] = Piece('white', 'P')
            self.grid[6][col] = Piece('black', 'P')

    @staticmethod
    def parse_square(s: str):
        """Convert algebraic square (e.g. 'e4') to (row, col)."""
        return int(s[1]) - 1, ord(s[0]) - ord('a')

    @staticmethod
    def square_name(row: int, col: int) -> str:
        return chr(ord('a') + col) + str(row + 1)

    def display(self):
        print('  a b c d e f g h')
        for row in range(7, -1, -1):
            rank = str(row + 1)
            cells = ' '.join(
                str(self.grid[row][col]) if self.grid[row][col] else '.'
                for col in range(8)
            )
            print(f'{rank} {cells} {rank}')
        print('  a b c d e f g h')

    def _opponent(self, color: str) -> str:
        return 'black' if color == 'white' else 'white'

    def _in_bounds(self, r: int, c: int) -> bool:
        return 0 <= r < 8 and 0 <= c < 8

    def _pseudo_legal_destinations(self, row: int, col: int):
        """Return pseudo-legal destination squares for the piece at (row, col)."""
        piece = self.grid[row][col]
        if piece is None:
            return []

        color = piece.color
        opp = self._opponent(color)
        moves = []

        def slide(dr, dc):
            r, c = row + dr, col + dc
            while self._in_bounds(r, c):
                target = self.grid[r][c]
                if target is None:
                    moves.append((r, c))
                elif target.color == opp:
                    moves.append((r, c))
                    break
                else:
                    break
                r += dr
                c += dc

        sym = piece.symbol

        if sym == 'P':
            d = 1 if color == 'white' else -1
            start_row = 1 if color == 'white' else 6
            # Forward one square
            r = row + d
            if self._in_bounds(r, col) and self.grid[r][col] is None:
                moves.append((r, col))
                # Double push from starting row
                rr = row + 2 * d
                if row == start_row and self.grid[rr][col] is None:
                    moves.append((rr, col))
            # Diagonal captures
            for dc in (-1, 1):
                r, c = row + d, col + dc
                if self._in_bounds(r, c):
                    target = self.grid[r][c]
                    if target is not None and target.color == opp:
                        moves.append((r, c))
                    elif self.en_passant_target == (r, c):
                        moves.append((r, c))

        elif sym == 'N':
            for dr, dc in ((-2, -1), (-2, 1), (-1, -2), (-1, 2),
                           (1, -2), (1, 2), (2, -1), (2, 1)):
                r, c = row + dr, col + dc
                if self._in_bounds(r, c):
                    t = self.grid[r][c]
                    if t is None or t.color == opp:
                        moves.append((r, c))

        elif sym == 'B':
            for dr, dc in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                slide(dr, dc)

        elif sym == 'R':
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                slide(dr, dc)

        elif sym == 'Q':
            for dr, dc in ((-1, -1), (-1, 1), (1, -1), (1, 1),
                           (-1, 0), (1, 0), (0, -1), (0, 1)):
                slide(dr, dc)

        elif sym == 'K':
            for dr, dc in ((-1, -1), (-1, 0), (-1, 1), (0, -1),
                           (0, 1), (1, -1), (1, 0), (1, 1)):
                r, c = row + dr, col + dc
                if self._in_bounds(r, c):
                    t = self.grid[r][c]
                    if t is None or t.color == opp:
                        moves.append((r, c))
            # Castling (squares must be empty; attack checks happen in legal_moves)
            kr = 0 if color == 'white' else 7
            if row == kr and col == 4:
                rights = self.castling_rights[color]
                if (rights['kingside']
                        and self.grid[kr][5] is None
                        and self.grid[kr][6] is None
                        and isinstance(self.grid[kr][7], Piece)
                        and self.grid[kr][7].symbol == 'R'
                        and self.grid[kr][7].color == color):
                    moves.append((kr, 6))
                if (rights['queenside']
                        and self.grid[kr][3] is None
                        and self.grid[kr][2] is None
                        and self.grid[kr][1] is None
                        and isinstance(self.grid[kr][0], Piece)
                        and self.grid[kr][0].symbol == 'R'
                        and self.grid[kr][0].color == color):
                    moves.append((kr, 2))

        return moves

    def _is_square_attacked(self, row: int, col: int, by_color: str) -> bool:
        """Return True if (row, col) can be captured by any piece of by_color."""
        for r in range(8):
            for c in range(8):
                p = self.grid[r][c]
                if p and p.color == by_color:
                    if (row, col) in self._pseudo_legal_destinations(r, c):
                        return True
        return False

    def is_in_check(self, color: str) -> bool:
        opp = self._opponent(color)
        for r in range(8):
            for c in range(8):
                p = self.grid[r][c]
                if p and p.color == color and p.symbol == 'K':
                    return self._is_square_attacked(r, c, opp)
        return False

    def _apply_move(self, fr: int, fc: int, tr: int, tc: int, promotion: str = 'Q') -> 'Board':
        """Return a new Board with the move applied (no legality check)."""
        b = copy.deepcopy(self)
        b._apply_move_inplace(fr, fc, tr, tc, promotion)
        return b

    def _apply_move_inplace(self, fr: int, fc: int, tr: int, tc: int, promotion: str = 'Q'):
        piece = self.grid[fr][fc]
        color = piece.color

        # En passant capture: remove the captured pawn
        if piece.symbol == 'P' and self.en_passant_target == (tr, tc):
            self.grid[fr][tc] = None

        # Reset en passant; set new target on double pawn push
        self.en_passant_target = None
        if piece.symbol == 'P' and abs(tr - fr) == 2:
            self.en_passant_target = ((fr + tr) // 2, fc)

        # Castling: also move the rook and revoke rights
        if piece.symbol == 'K':
            self.castling_rights[color] = {'kingside': False, 'queenside': False}
            if tc - fc == 2:   # kingside
                self.grid[fr][5] = self.grid[fr][7]
                self.grid[fr][7] = None
            elif fc - tc == 2:  # queenside
                self.grid[fr][3] = self.grid[fr][0]
                self.grid[fr][0] = None

        # Revoke castling right when a rook moves from its starting corner
        if piece.symbol == 'R':
            if fc == 0:
                self.castling_rights[color]['queenside'] = False
            elif fc == 7:
                self.castling_rights[color]['kingside'] = False

        # Revoke opponent's castling right if their rook is captured
        captured = self.grid[tr][tc]
        if captured and captured.symbol == 'R':
            opp = self._opponent(color)
            opp_back = 7 if color == 'white' else 0
            if tr == opp_back:
                if tc == 0:
                    self.castling_rights[opp]['queenside'] = False
                elif tc == 7:
                    self.castling_rights[opp]['kingside'] = False

        # Place piece on destination
        self.grid[tr][tc] = piece
        self.grid[fr][fc] = None

        # Pawn promotion
        if piece.symbol == 'P' and (tr == 7 or tr == 0):
            self.grid[tr][tc] = Piece(color, promotion)

    def legal_moves(self, color: str):
        """Return all legal (from_sq, to_sq) pairs for color."""
        opp = self._opponent(color)
        moves = []
        for r in range(8):
            for c in range(8):
                p = self.grid[r][c]
                if not (p and p.color == color):
                    continue
                for tr, tc in self._pseudo_legal_destinations(r, c):
                    # Castling requires king not currently in check and not
                    # passing through an attacked square.
                    if p.symbol == 'K' and abs(tc - c) == 2:
                        direction = 1 if tc > c else -1
                        if (self._is_square_attacked(r, c, opp)
                                or self._is_square_attacked(r, c + direction, opp)):
                            continue
                    b = self._apply_move(r, c, tr, tc)
                    if not b.is_in_check(color):
                        moves.append(((r, c), (tr, tc)))
        return moves

    def make_move(self, from_sq, to_sq, promotion: str = 'Q') -> bool:
        """Apply a move if it is legal. Returns True on success."""
        fr, fc = from_sq
        tr, tc = to_sq
        piece = self.grid[fr][fc]
        if piece is None or piece.color != self.turn:
            return False
        if (tr, tc) not in self._pseudo_legal_destinations(fr, fc):
            return False

        opp = self._opponent(self.turn)
        if piece.symbol == 'K' and abs(tc - fc) == 2:
            direction = 1 if tc > fc else -1
            if (self._is_square_attacked(fr, fc, opp)
                    or self._is_square_attacked(fr, fc + direction, opp)):
                return False

        trial = self._apply_move(fr, fc, tr, tc, promotion)
        if trial.is_in_check(self.turn):
            return False

        self._apply_move_inplace(fr, fc, tr, tc, promotion)
        self.turn = opp
        return True

    def is_checkmate(self) -> bool:
        return self.is_in_check(self.turn) and not self.legal_moves(self.turn)

    def is_stalemate(self) -> bool:
        return not self.is_in_check(self.turn) and not self.legal_moves(self.turn)

    def to_fen(self) -> str:
        """Return the FEN string for the current position."""
        rows = []
        for row in range(7, -1, -1):
            empty = 0
            r_str = ''
            for col in range(8):
                p = self.grid[row][col]
                if p is None:
                    empty += 1
                else:
                    if empty:
                        r_str += str(empty)
                        empty = 0
                    r_str += str(p)
            if empty:
                r_str += str(empty)
            rows.append(r_str)
        board_part = '/'.join(rows)

        turn = 'w' if self.turn == 'white' else 'b'

        cr = self.castling_rights
        castling = ''
        if cr['white']['kingside']:
            castling += 'K'
        if cr['white']['queenside']:
            castling += 'Q'
        if cr['black']['kingside']:
            castling += 'k'
        if cr['black']['queenside']:
            castling += 'q'
        castling = castling or '-'

        if self.en_passant_target:
            ep = self.square_name(*self.en_passant_target)
        else:
            ep = '-'

        return f'{board_part} {turn} {castling} {ep} 0 1'


def parse_move(s: str):
    """Parse 'e2e4', 'e2-e4', or 'e7e8Q' into (from_sq, to_sq, promotion)."""
    s = s.strip().replace('-', '').lower()
    promotion = 'Q'
    if len(s) == 5:
        promotion = s[4].upper()
        s = s[:4]
    if len(s) != 4:
        return None, None, None
    try:
        from_sq = Board.parse_square(s[:2])
        to_sq = Board.parse_square(s[2:4])
    except (ValueError, IndexError):
        return None, None, None
    return from_sq, to_sq, promotion


def main():
    board = Board()
    print("Chess — enter moves as 'e2e4'. Append promotion piece if needed (e.g. 'e7e8Q').")
    print("Type 'fen' to print the current FEN, or 'quit' to exit.\n")

    while True:
        board.display()
        print()

        if board.is_checkmate():
            winner = 'Black' if board.turn == 'white' else 'White'
            print(f'Checkmate! {winner} wins!')
            break

        if board.is_stalemate():
            print("Stalemate — it's a draw.")
            break

        if board.is_in_check(board.turn):
            print(f'{board.turn.capitalize()} is in check!')

        try:
            raw = input(f"{board.turn.capitalize()}'s move: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if raw.lower() == 'quit':
            break

        if raw.lower() == 'fen':
            print(board.to_fen())
            continue

        from_sq, to_sq, promotion = parse_move(raw)
        if from_sq is None:
            print("Invalid format. Use 'e2e4'.")
            continue

        if not board.make_move(from_sq, to_sq, promotion):
            print('Illegal move.')


if __name__ == '__main__':
    main()
