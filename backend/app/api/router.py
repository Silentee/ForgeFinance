from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.api.endpoints import (
    auth,
    institutions,
    accounts,
    transactions,
    imports,
    balances,
    categories,
    budgets,
    reports,
    demo,
    export,
)

api_router = APIRouter()

# Auth routes are public (they handle their own auth)
api_router.include_router(auth.router, prefix="/auth", tags=["Auth"])

# All other routes require authentication
protected = APIRouter(dependencies=[Depends(get_current_user)])
protected.include_router(institutions.router, prefix="/institutions", tags=["Institutions"])
protected.include_router(accounts.router,     prefix="/accounts",     tags=["Accounts"])
protected.include_router(transactions.router, prefix="/transactions", tags=["Transactions"])
protected.include_router(imports.router,      prefix="/imports",      tags=["CSV Import"])
protected.include_router(balances.router,     prefix="/balances",     tags=["Balances"])
protected.include_router(categories.router,   prefix="/categories",   tags=["Categories"])
protected.include_router(budgets.router,      prefix="/budgets",      tags=["Budgets"])
protected.include_router(reports.router,      prefix="/reports",      tags=["Reports"])
protected.include_router(demo.router,         prefix="/demo",         tags=["Demo"])
protected.include_router(export.router,       prefix="/export",       tags=["Export"])

api_router.include_router(protected)
